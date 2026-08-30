/**
 * Sync orchestration: resolve credentials, call a connector, write the facts,
 * record what happened.
 *
 * The write is an upsert on the fact grain, so re-running a window is safe.
 * That matters more than it sounds: providers restate recent days (Search
 * Console especially), so the nightly job deliberately re-pulls a trailing
 * window and overwrites rather than appending.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  channelAccounts,
  connections,
  metricFacts,
  syncRuns,
  type Provider,
} from "@/db/schema";
import { METRIC_BY_KEY } from "@/metrics/catalog";
import { openJson } from "@/lib/crypto";
import { getConnector } from "./registry";
import { hashDimensions, type Credentials, type DateRange, type FactInput } from "./types";

/** Rows per INSERT. Large enough to be fast, small enough to stay under limits. */
const CHUNK_SIZE = 1000;

export interface SyncOutcome {
  accountId: string;
  provider: Provider;
  status: "success" | "partial" | "failed" | "skipped";
  rowsWritten: number;
  warnings: string[];
  error?: string;
}

async function resolveCredentials(
  clientId: string,
  provider: Provider,
): Promise<Credentials> {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.clientId, clientId), eq(connections.provider, provider)))
    .limit(1);

  if (!row) {
    throw new Error(
      `No connection stored for provider "${provider}". ` +
        "Add credentials before syncing this account.",
    );
  }
  if (!row.encryptedCredentials) {
    throw new Error(`Connection for "${provider}" exists but holds no credentials.`);
  }

  return openJson<Credentials>(row.encryptedCredentials);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Reject facts naming metrics that are not in the catalog.
 *
 * The DB foreign key would catch these too, but it would abort the whole
 * batch. Filtering here means one bad metric costs one metric, not the sync.
 */
function partitionValidFacts(facts: FactInput[]): {
  valid: FactInput[];
  warnings: string[];
} {
  const valid: FactInput[] = [];
  const unknown = new Set<string>();

  for (const fact of facts) {
    if (METRIC_BY_KEY.has(fact.metricKey)) valid.push(fact);
    else unknown.add(fact.metricKey);
  }

  const warnings = unknown.size
    ? [`Dropped facts for metric keys absent from the catalog: ${[...unknown].join(", ")}.`]
    : [];

  return { valid, warnings };
}

/** Run one account for one date range. */
export async function syncAccount(
  accountId: string,
  range: DateRange,
): Promise<SyncOutcome> {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, accountId))
    .limit(1);

  if (!account) throw new Error(`No channel account with id ${accountId}.`);

  const base = { accountId, provider: account.provider };

  // Accounts that cannot be collected from are a normal state, not an error:
  // Reddit and Quora do not exist yet, and some surfaces have no usable API.
  if (account.status !== "active") {
    return {
      ...base,
      status: "skipped",
      rowsWritten: 0,
      warnings: [`Account "${account.displayName}" is ${account.status}; nothing to sync.`],
    };
  }

  const connector = getConnector(account.provider);
  if (!connector) {
    return {
      ...base,
      status: "skipped",
      rowsWritten: 0,
      warnings: [`No connector implemented for provider "${account.provider}" yet.`],
    };
  }

  if (!account.externalId) {
    return {
      ...base,
      status: "failed",
      rowsWritten: 0,
      warnings: [],
      error: `Account "${account.displayName}" is active but has no externalId.`,
    };
  }

  const [run] = await db
    .insert(syncRuns)
    .values({
      clientId: account.clientId,
      channelAccountId: account.id,
      provider: account.provider,
      status: "running",
      rangeStart: range.start,
      rangeEnd: range.end,
    })
    .returning();

  try {
    const result = await connector.fetch({
      accountId: account.id,
      clientId: account.clientId,
      externalId: account.externalId,
      range,
      config: (account.config ?? {}) as Record<string, unknown>,
      credentials: await resolveCredentials(account.clientId, account.provider),
    });

    const { valid, warnings: catalogWarnings } = partitionValidFacts(result.facts);
    const warnings = [...result.warnings, ...catalogWarnings];

    const rows = valid.map((fact) => ({
      clientId: account.clientId,
      channelAccountId: account.id,
      metricKey: fact.metricKey,
      date: fact.date,
      value: String(fact.value),
      dimensions: fact.dimensions ?? {},
      dimensionsHash: hashDimensions(fact.dimensions),
      provider: account.provider,
      syncRunId: run.id,
    }));

    let rowsWritten = 0;
    for (const batch of chunk(rows, CHUNK_SIZE)) {
      const written = await db
        .insert(metricFacts)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            metricFacts.channelAccountId,
            metricFacts.metricKey,
            metricFacts.date,
            metricFacts.dimensionsHash,
          ],
          set: {
            // `excluded` is the row the insert tried to add: last write wins,
            // which is what makes a re-pull of restated days correct.
            value: sql`excluded.value`,
            syncRunId: run.id,
            ingestedAt: new Date(),
          },
        })
        .returning({ id: metricFacts.id });
      rowsWritten += written.length;
    }

    const status = warnings.length > 0 ? "partial" : "success";
    await db
      .update(syncRuns)
      .set({ status, rowsWritten, warnings, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));

    return { ...base, status, rowsWritten, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));

    return { ...base, status: "failed", rowsWritten: 0, warnings: [], error: message };
  }
}

/** Sync every active account for a client. */
export async function syncClient(
  clientId: string,
  range: DateRange,
): Promise<SyncOutcome[]> {
  const accounts = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(eq(channelAccounts.clientId, clientId));

  const outcomes: SyncOutcome[] = [];
  // Sequential on purpose: provider quotas are per-project, and a burst of
  // parallel requests is the fastest way to get rate-limited.
  for (const { id } of accounts) {
    outcomes.push(await syncAccount(id, range));
  }
  return outcomes;
}
