/**
 * Google Search Console connector (Search Analytics API).
 *
 * Covers the website channel's acquisition side: what Frak Finance ranks for,
 * how often it is shown, and what gets clicked. GA4 cannot answer any of that,
 * which is why the website channel needs two providers.
 *
 * Access: add the service-account email as a restricted user on the Search
 * Console property. No app review.
 */
import type { Connector, ConnectorContext, ConnectorResult, FactInput } from "./types";
import { GSC_SCOPE, getAccessToken, postJson } from "./google-auth";

/** Search Console's four native metrics map cleanly onto the catalog. */
const METRIC_MAP = {
  clicks: "clicks",
  impressions: "impressions",
  ctr: "ctr",
  position: "average_position",
} as const;

/** Search Console reporting lags real time by roughly two to three days. */
const FRESHNESS_LAG_DAYS = 3;

/** Rows per page; the API's documented maximum. */
const PAGE_SIZE = 25000;
/** Safety cap so an unexpectedly large site cannot run a sync forever. */
const MAX_PAGES = 8;

interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
}

const ENDPOINT = (siteUrl: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl,
  )}/searchAnalytics/query`;

async function queryAllPages(
  siteUrl: string,
  token: string,
  dimensions: string[],
  range: { start: string; end: string },
): Promise<SearchAnalyticsRow[]> {
  const rows: SearchAnalyticsRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await postJson<SearchAnalyticsResponse>(ENDPOINT(siteUrl), token, {
      startDate: range.start,
      endDate: range.end,
      dimensions,
      rowLimit: PAGE_SIZE,
      startRow: page * PAGE_SIZE,
    });

    const batch = res.rows ?? [];
    rows.push(...batch);
    // A short page means there is nothing after it.
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export const searchConsoleConnector: Connector = {
  provider: "google_search_console",
  channel: "website",
  emits: [...new Set(Object.values(METRIC_MAP))],
  // Search Console retains roughly 16 months of search analytics.
  maxBackfillDays: 480,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult> {
    const token = await getAccessToken(ctx.credentials, [GSC_SCOPE]);
    const warnings: string[] = [];
    const facts: FactInput[] = [];

    // Warn rather than silently reporting a dip that is really just lag.
    const lag = daysBetween(new Date(`${ctx.range.end}T00:00:00Z`), new Date());
    if (lag < FRESHNESS_LAG_DAYS) {
      warnings.push(
        `Search Console lags roughly ${FRESHNESS_LAG_DAYS} days. Figures for the last ` +
          `${FRESHNESS_LAG_DAYS - lag} day(s) of this range will be incomplete and will ` +
          `rise on a later re-sync.`,
      );
    }

    // Daily site totals.
    const daily = await queryAllPages(ctx.externalId, token, ["date"], ctx.range);
    for (const row of daily) {
      const date = row.keys[0];
      for (const [native, metricKey] of Object.entries(METRIC_MAP)) {
        const value = row[native as keyof typeof METRIC_MAP];
        if (typeof value !== "number" || Number.isNaN(value)) continue;
        facts.push({ metricKey, date, value });
      }
    }

    // Per-query breakdown, so the dashboard can show which searches actually
    // bring Frak Finance traffic. Stored as dimensioned facts on the same
    // metric keys, which keeps it out of a separate table.
    try {
      const byQuery = await queryAllPages(ctx.externalId, token, ["date", "query"], ctx.range);
      for (const row of byQuery) {
        const [date, query] = row.keys;
        facts.push(
          { metricKey: "clicks", date, value: row.clicks, dimensions: { query } },
          { metricKey: "impressions", date, value: row.impressions, dimensions: { query } },
          { metricKey: "average_position", date, value: row.position, dimensions: { query } },
        );
      }
    } catch (err) {
      warnings.push(
        `Search Console query breakdown failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (facts.length === 0) {
      warnings.push(
        `Search Console site ${ctx.externalId} returned no rows for ` +
          `${ctx.range.start}..${ctx.range.end}. For a newly verified property this is normal.`,
      );
    }

    return { facts, warnings };
  },
};
