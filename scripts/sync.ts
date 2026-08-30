/**
 * Sync entrypoint.
 *
 *   npm run sync                    last 7 days for the default client
 *   npm run sync -- --days 90       backfill a wider window
 *   npm run sync -- --client acme   a different tenant
 *
 * Re-pulls a trailing window rather than only yesterday, because providers
 * restate recent days. The upsert on the fact grain makes that safe.
 */
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncClient } from "@/connectors/run";
import { lastNDays } from "@/lib/format";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const slug = arg("client", "frak-finance");
  const days = Number(arg("days", "7"));
  if (!Number.isFinite(days) || days < 1) throw new Error(`--days must be a positive number.`);

  const [client] = await db.select().from(clients).where(eq(clients.slug, slug)).limit(1);
  if (!client) throw new Error(`No client with slug "${slug}". Run npm run db:seed first.`);

  const range = lastNDays(days);
  console.log(`Syncing ${client.name}: ${range.start} to ${range.end}\n`);

  const outcomes = await syncClient(client.id, range);

  let rows = 0;
  for (const o of outcomes) {
    const mark =
      o.status === "success" ? "OK  " :
      o.status === "partial" ? "WARN" :
      o.status === "failed"  ? "FAIL" : "SKIP";
    console.log(`${mark}  ${o.provider.padEnd(24)} ${o.rowsWritten} rows`);
    for (const w of o.warnings) console.log(`        ${w}`);
    if (o.error) console.log(`        ${o.error}`);
    rows += o.rowsWritten;
  }

  const failed = outcomes.filter((o) => o.status === "failed").length;
  console.log(`\n${rows} rows written, ${failed} account(s) failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
