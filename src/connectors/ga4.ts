/**
 * Google Analytics 4 connector (Data API v1beta, runReport).
 *
 * Covers the website channel's on-site behaviour: who arrived, how many,
 * where from, and whether they converted.
 *
 * Access: add the service-account email as a Viewer on the GA4 property.
 * No app review, no approval queue.
 */
import type { Connector, ConnectorContext, ConnectorResult, FactInput } from "./types";
import { GA4_SCOPE, ga4DateToIso, getAccessToken, postJson } from "./google-auth";

/** GA4 native metric name -> our canonical key. */
const METRIC_MAP: Record<string, string> = {
  sessions: "sessions",
  totalUsers: "users",
  newUsers: "new_users",
  screenPageViews: "pageviews",
  bounceRate: "bounce_rate",
  averageSessionDuration: "average_session_duration",
  keyEvents: "conversions",
};

interface RunReportResponse {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: {
    dimensionValues: { value: string }[];
    metricValues: { value: string }[];
  }[];
}

const ENDPOINT = (propertyId: string) =>
  `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

/**
 * `keyEvents` replaced `conversions` in GA4 during 2024, and properties that
 * have never configured a key event reject the metric outright. Rather than
 * fail the whole sync for one optional metric, drop the rejected name and
 * retry once, recording a warning.
 */
function metricNameFromError(message: string, candidates: string[]): string | null {
  return candidates.find((name) => message.includes(name)) ?? null;
}

async function runReport(
  propertyId: string,
  token: string,
  metricNames: string[],
  dimensions: string[],
  range: { start: string; end: string },
): Promise<RunReportResponse> {
  return postJson<RunReportResponse>(ENDPOINT(propertyId), token, {
    dateRanges: [{ startDate: range.start, endDate: range.end }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metricNames.map((name) => ({ name })),
    limit: 100000,
  });
}

export const ga4Connector: Connector = {
  provider: "ga4",
  channel: "website",
  emits: [...new Set(Object.values(METRIC_MAP))],
  // GA4 retains standard reports for 14 months on the free tier by default.
  maxBackfillDays: 400,

  async fetch(ctx: ConnectorContext): Promise<ConnectorResult> {
    const token = await getAccessToken(ctx.credentials, [GA4_SCOPE]);
    const warnings: string[] = [];
    const facts: FactInput[] = [];

    let metricNames = Object.keys(METRIC_MAP);
    let report: RunReportResponse;

    try {
      report = await runReport(ctx.externalId, token, metricNames, ["date"], ctx.range);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const rejected = metricNameFromError(message, metricNames);
      if (!rejected) throw err;

      warnings.push(
        `GA4 property ${ctx.externalId} rejected metric "${rejected}" ` +
          `(commonly means no key events are configured). Continuing without it.`,
      );
      metricNames = metricNames.filter((n) => n !== rejected);
      report = await runReport(ctx.externalId, token, metricNames, ["date"], ctx.range);
    }

    // Trust the response headers for ordering rather than the request array;
    // the API is documented to echo order but the headers are authoritative.
    const headers = (report.metricHeaders ?? []).map((h) => h.name);

    for (const row of report.rows ?? []) {
      const date = ga4DateToIso(row.dimensionValues[0]?.value ?? "");

      headers.forEach((nativeName, i) => {
        const metricKey = METRIC_MAP[nativeName];
        if (!metricKey) return;

        const raw = row.metricValues[i]?.value;
        const value = Number(raw);
        if (raw === undefined || Number.isNaN(value)) return;

        facts.push({ metricKey, date, value });
      });
    }

    // Traffic source breakdown, stored as a dimensioned variant of `sessions`.
    // The unified fact table handles this via `dimensions`, so no new table is
    // needed to answer "how much of our traffic is organic?".
    try {
      const bySource = await runReport(
        ctx.externalId,
        token,
        ["sessions"],
        ["date", "sessionDefaultChannelGroup"],
        ctx.range,
      );

      for (const row of bySource.rows ?? []) {
        const date = ga4DateToIso(row.dimensionValues[0]?.value ?? "");
        const group = row.dimensionValues[1]?.value ?? "(other)";
        const value = Number(row.metricValues[0]?.value);
        if (Number.isNaN(value)) continue;

        facts.push({
          metricKey: "sessions",
          date,
          value,
          dimensions: { channel_group: group },
        });
      }
    } catch (err) {
      // The headline numbers already succeeded; a failed breakdown should
      // degrade the report, not void the sync.
      warnings.push(
        `GA4 channel-group breakdown failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (facts.length === 0) {
      warnings.push(
        `GA4 property ${ctx.externalId} returned no rows for ${ctx.range.start}..${ctx.range.end}.`,
      );
    }

    return { facts, warnings };
  },
};
