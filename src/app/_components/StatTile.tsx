import { computeDelta, formatValue } from "@/lib/format";

interface Props {
  label: string;
  value: number;
  previousValue: number | null;
  unit: string;
  higherIsBetter: boolean;
  /** Shown when the metric has no data at all, in place of a misleading zero. */
  emptyNote?: string;
}

/**
 * A single headline number.
 *
 * The delta pairs an arrow glyph with a signed percentage, so direction is
 * never carried by color alone. `higherIsBetter` is respected: a falling
 * average search position is an improvement and is shown as one.
 */
export function StatTile({
  label,
  value,
  previousValue,
  unit,
  higherIsBetter,
  emptyNote,
}: Props) {
  const delta = computeDelta(value, previousValue, higherIsBetter);

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>

      {emptyNote ? (
        <>
          <div className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-muted)" }}>
            &mdash;
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {emptyNote}
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatValue(value, unit)}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {delta === null ? (
              <span style={{ color: "var(--text-muted)" }}>no prior period</span>
            ) : delta.direction === "flat" ? (
              <span>&#8212; flat vs prior period</span>
            ) : (
              <span style={{ color: delta.isGood ? "var(--delta-up)" : "var(--status-critical)" }}>
                {delta.direction === "up" ? "↑" : "↓"} {Math.abs(delta.pct).toFixed(1)}%
                <span style={{ color: "var(--text-secondary)" }}> vs prior period</span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
