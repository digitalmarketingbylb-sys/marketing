import { getAccountCoverage, getClientBySlug, getKpis, getTimeseries, getTopQueries } from "@/db/queries";
import { CoverageTable } from "./_components/CoverageTable";
import { StatTile } from "./_components/StatTile";
import { TrendChart } from "./_components/TrendChart";
import { compactNumber, lastNDays } from "@/lib/format";

// Always read live: a marketing dashboard showing a cached yesterday is a bug.
export const dynamic = "force-dynamic";

/** Client is fixed for now. Multi-tenancy is in the schema; routing comes next. */
const CLIENT_SLUG = process.env.DEFAULT_CLIENT_SLUG ?? "frak-finance";

/** The tiles that lead the page, in reading order. */
const HEADLINE_METRICS = [
  "sessions",
  "clicks",
  "impressions",
  "engagements",
  "followers",
  "meetings_booked",
];

export default async function DashboardPage() {
  const range = lastNDays(30);
  const client = await getClientBySlug(CLIENT_SLUG);

  if (!client) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <h1 className="text-xl font-semibold">No client seeded</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          Run <code>npm run db:migrate &amp;&amp; npm run db:seed</code> to create the
          Frak Finance workspace.
        </p>
      </main>
    );
  }

  const [kpis, coverage, reachTrend, topQueries] = await Promise.all([
    getKpis(CLIENT_SLUG, range),
    getAccountCoverage(CLIENT_SLUG),
    // Impressions is the one metric every channel reports, which makes it the
    // only honest choice for a single cross-channel trend line. Sessions is
    // website-only and would leave the other channels flat at zero.
    getTimeseries(CLIENT_SLUG, "impressions", range),
    getTopQueries(CLIENT_SLUG, range),
  ]);

  const kpiByKey = new Map(kpis.map((k) => [k.metricKey, k]));
  const liveAccounts = coverage.filter((a) => a.status === "active").length;
  const totalRows = coverage.reduce((a, c) => a + c.factCount, 0);

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {client.name}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Marketing performance &middot; {range.start} to {range.end} &middot;{" "}
          {client.timezone}
        </p>
      </header>

      {/*
        Until a connector is authorised, the honest headline is the state of
        the pipeline, not a wall of zeros.
      */}
      {liveAccounts === 0 && (
        <div
          className="mb-6 rounded-lg p-4 text-sm"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--status-warning)",
          }}
        >
          <strong style={{ color: "var(--text-primary)" }}>
            No channel is syncing yet.
          </strong>
          <span style={{ color: "var(--text-secondary)" }}>
            {" "}
            The pipeline is built and the schema is live; every account below is
            waiting on credentials or platform access. Figures stay blank rather
            than showing zero, because zero and &ldquo;not connected&rdquo; mean
            very different things.
          </span>
        </div>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {HEADLINE_METRICS.map((key) => {
          const k = kpiByKey.get(key);
          if (!k) {
            return (
              <StatTile
                key={key}
                label={LABEL_FALLBACK[key] ?? key}
                value={0}
                previousValue={null}
                unit="count"
                higherIsBetter
                emptyNote="not connected"
              />
            );
          }
          return (
            <StatTile
              key={key}
              label={k.label}
              value={k.value}
              previousValue={k.previousValue}
              unit={k.unit}
              higherIsBetter={k.higherIsBetter}
            />
          );
        })}
      </section>

      <div className="mb-6">
        <TrendChart
          title="Impressions by channel"
          points={reachTrend}
          emptyState={
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Nothing to plot yet. Connect GA4 and Search Console, then run{" "}
              <code>npm run sync</code> to backfill this window.
            </p>
          }
        />
      </div>

      {topQueries.length > 0 && (
        <section
          className="mb-6 rounded-lg p-5"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Top search queries
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--text-secondary)" }}>
                  <th className="py-2 pr-4 text-left font-medium">Query</th>
                  <th className="py-2 pr-4 text-right font-medium">Clicks</th>
                  <th className="py-2 pr-4 text-right font-medium">Impressions</th>
                  <th className="py-2 text-right font-medium">Avg. position</th>
                </tr>
              </thead>
              <tbody>
                {topQueries.map((q) => (
                  <tr key={q.query} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-2 pr-4" style={{ color: "var(--text-primary)" }}>{q.query}</td>
                    <td className="py-2 pr-4 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                      {compactNumber(q.clicks)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                      {compactNumber(q.impressions)}
                    </td>
                    <td className="py-2 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                      {q.position.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <CoverageTable accounts={coverage} />

      <footer className="mt-6 text-xs" style={{ color: "var(--text-muted)" }}>
        {coverage.length} accounts across {new Set(coverage.map((c) => c.brand)).size} brands
        &middot; {totalRows.toLocaleString("en-US")} facts stored
      </footer>
    </main>
  );
}

/** Labels for tiles whose metric has no rows yet, so the grid stays readable. */
const LABEL_FALLBACK: Record<string, string> = {
  sessions: "Sessions",
  clicks: "Clicks",
  impressions: "Impressions",
  engagements: "Engagements",
  followers: "Followers",
  meetings_booked: "Meetings Booked",
};
