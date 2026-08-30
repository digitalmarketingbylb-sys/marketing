/**
 * Integration tests against a real Postgres.
 *
 * These exist because the aggregation rules live in SQL, and SQL is exactly
 * where a follower count gets summed across 30 days without anyone noticing.
 * Requires DATABASE_URL and a migrated database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./index";
import { getChannelBreakdown, getKpis, getTopQueries } from "./queries";
import { hashDimensions } from "@/connectors/types";

const SLUG = "test-tenant";
const OTHER_SLUG = "test-other-tenant";
const RANGE = { start: "2026-08-01", end: "2026-08-03" };

let accountA: string;
let accountB: string;

async function seedTenant(slug: string, brandName: string) {
  const [client] = await db.execute<{ id: string }>(sql`
    insert into clients (slug, name) values (${slug}, ${brandName})
    on conflict (slug) do update set name = excluded.name
    returning id::text
  `);
  const [brand] = await db.execute<{ id: string }>(sql`
    insert into brands (client_id, slug, name, kind)
    values (${client.id}::uuid, 'b1', ${brandName}, 'company')
    on conflict (client_id, slug) do update set name = excluded.name
    returning id::text
  `);
  return { clientId: client.id, brandId: brand.id };
}

async function addAccount(
  clientId: string,
  brandId: string,
  channel: string,
  displayName: string,
) {
  const [row] = await db.execute<{ id: string }>(sql`
    insert into channel_accounts (client_id, brand_id, channel, provider, display_name, status)
    values (${clientId}::uuid, ${brandId}::uuid, ${channel}::channel, 'ga4', ${displayName}, 'active')
    returning id::text
  `);
  return row.id;
}

async function addFact(
  clientId: string,
  accountId: string,
  metricKey: string,
  date: string,
  value: number,
  dimensions: Record<string, string> = {},
) {
  await db.execute(sql`
    insert into metric_facts
      (client_id, channel_account_id, metric_key, date, value, dimensions, dimensions_hash, provider)
    values (
      ${clientId}::uuid, ${accountId}::uuid, ${metricKey}, ${date}::date, ${value},
      ${JSON.stringify(dimensions)}::jsonb, ${hashDimensions(dimensions)}, 'ga4'
    )
  `);
}

beforeAll(async () => {
  await db.execute(sql`delete from clients where slug in (${SLUG}, ${OTHER_SLUG})`);

  // The metric catalog must be present; facts reference it by foreign key.
  const [{ count }] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from metric_definitions`,
  );
  if (Number(count) === 0) {
    throw new Error("Run `npm run db:seed` before the integration tests.");
  }

  const { clientId, brandId } = await seedTenant(SLUG, "Test Tenant");
  accountA = await addAccount(clientId, brandId, "linkedin", "Test LinkedIn");
  accountB = await addAccount(clientId, brandId, "x", "Test X");

  // Flow metric: should sum.
  await addFact(clientId, accountA, "impressions", "2026-08-01", 100);
  await addFact(clientId, accountA, "impressions", "2026-08-02", 200);
  await addFact(clientId, accountA, "impressions", "2026-08-03", 300);

  // Snapshot metric on two accounts: newest per account, then summed.
  await addFact(clientId, accountA, "followers", "2026-08-01", 1000);
  await addFact(clientId, accountA, "followers", "2026-08-02", 1010);
  await addFact(clientId, accountA, "followers", "2026-08-03", 1020);
  await addFact(clientId, accountB, "followers", "2026-08-03", 500);

  // Dimensioned rows must never reach the headline totals.
  await addFact(clientId, accountA, "clicks", "2026-08-01", 50);
  await addFact(clientId, accountA, "clicks", "2026-08-01", 30, { query: "outsourced cfo" });
  await addFact(clientId, accountA, "impressions", "2026-08-01", 400, { query: "outsourced cfo" });

  // A second tenant with large numbers, to prove isolation.
  const other = await seedTenant(OTHER_SLUG, "Other Tenant");
  const otherAccount = await addAccount(other.clientId, other.brandId, "linkedin", "Other LinkedIn");
  await addFact(other.clientId, otherAccount, "impressions", "2026-08-01", 999_999);
});

afterAll(async () => {
  await db.execute(sql`delete from clients where slug in (${SLUG}, ${OTHER_SLUG})`);
});

describe("getKpis", () => {
  it("sums flow metrics across the range", async () => {
    const kpis = await getKpis(SLUG, RANGE);
    expect(kpis.find((k) => k.metricKey === "impressions")?.value).toBe(600);
  });

  it("takes the newest reading per account for snapshot metrics, then sums", async () => {
    // 1020 (newest for A) + 500 (newest for B) = 1520.
    // A naive SUM would give 3530 and look plausible.
    const kpis = await getKpis(SLUG, RANGE);
    expect(kpis.find((k) => k.metricKey === "followers")?.value).toBe(1520);
  });

  it("excludes dimensioned breakdown rows from headline totals", async () => {
    const kpis = await getKpis(SLUG, RANGE);
    // 50 undimensioned; the 30 tagged with a query must not be added.
    expect(kpis.find((k) => k.metricKey === "clicks")?.value).toBe(50);
  });

  it("isolates tenants", async () => {
    const kpis = await getKpis(SLUG, RANGE);
    const impressions = kpis.find((k) => k.metricKey === "impressions")?.value ?? 0;
    expect(impressions).toBeLessThan(999_999);

    const other = await getKpis(OTHER_SLUG, RANGE);
    expect(other.find((k) => k.metricKey === "impressions")?.value).toBe(999_999);
  });

  it("returns nothing for an unknown client rather than leaking rows", async () => {
    expect(await getKpis("no-such-client", RANGE)).toEqual([]);
  });
});

describe("getChannelBreakdown", () => {
  it("splits a snapshot metric per channel without double counting", async () => {
    const rows = await getChannelBreakdown(SLUG, "followers", RANGE);
    expect(rows.find((r) => r.channel === "linkedin")?.value).toBe(1020);
    expect(rows.find((r) => r.channel === "x")?.value).toBe(500);
  });
});

describe("getTopQueries", () => {
  it("reads the dimensioned Search Console facts", async () => {
    const rows = await getTopQueries(SLUG, RANGE);
    const row = rows.find((r) => r.query === "outsourced cfo");
    expect(row?.clicks).toBe(30);
    expect(row?.impressions).toBe(400);
  });
});
