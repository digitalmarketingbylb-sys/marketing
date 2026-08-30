import type { AccountCoverage } from "@/db/queries";
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, CHANNEL_GROUP, CHANNEL_LABEL } from "@/lib/channels";
import type { Channel } from "@/db/schema";

const TONE_COLOR: Record<string, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  muted: "var(--text-muted)",
};

/** Icon plus label: a status is never conveyed by color alone. */
const TONE_ICON: Record<string, string> = {
  good: "●",
  warning: "◐",
  serious: "▲",
  muted: "○",
};

/**
 * Which channels are actually feeding the dashboard.
 *
 * This sits above the numbers on purpose. A dashboard that reports zero
 * without saying "never connected" is worse than no dashboard: zero reads as
 * failure when the truth is absence.
 */
export function CoverageTable({ accounts }: { accounts: AccountCoverage[] }) {
  const counts = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section
      className="rounded-lg p-5"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Channel coverage
        </h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {Object.entries(counts).map(([status, n]) => (
            <span key={status} style={{ color: "var(--text-secondary)" }}>
              <span aria-hidden style={{ color: TONE_COLOR[ACCOUNT_STATUS_TONE[status] ?? "muted"] }}>
                {TONE_ICON[ACCOUNT_STATUS_TONE[status] ?? "muted"]}
              </span>{" "}
              {n} {ACCOUNT_STATUS_LABEL[status] ?? status}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th className="py-2 pr-4 text-left font-medium">Account</th>
              <th className="py-2 pr-4 text-left font-medium">Brand</th>
              <th className="py-2 pr-4 text-left font-medium">Channel</th>
              <th className="py-2 pr-4 text-left font-medium">Status</th>
              <th className="py-2 pr-4 text-right font-medium">Rows</th>
              <th className="py-2 text-left font-medium">Last sync</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const tone = ACCOUNT_STATUS_TONE[a.status] ?? "muted";
              const group = CHANNEL_GROUP[a.channel as Channel];
              return (
                <tr key={a.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2 pr-4" style={{ color: "var(--text-primary)" }}>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer"
                         className="underline underline-offset-2">
                        {a.displayName}
                      </a>
                    ) : (
                      a.displayName
                    )}
                    {a.note && (
                      <div className="mt-0.5 max-w-md" style={{ color: "var(--text-muted)" }}>
                        {a.note}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4" style={{ color: "var(--text-secondary)" }}>{a.brand}</td>
                  <td className="py-2 pr-4" style={{ color: "var(--text-secondary)" }}>
                    {CHANNEL_LABEL[group] ?? a.channel}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    <span aria-hidden style={{ color: TONE_COLOR[tone] }}>{TONE_ICON[tone]}</span>{" "}
                    {ACCOUNT_STATUS_LABEL[a.status] ?? a.status}
                  </td>
                  <td className="py-2 pr-4 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                    {a.factCount.toLocaleString("en-US")}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-muted)" }}>
                    {a.lastSyncAt ? a.lastSyncAt.slice(0, 16).replace("T", " ") : "never"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
