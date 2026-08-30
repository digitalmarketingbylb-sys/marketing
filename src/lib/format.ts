/** Presentation helpers. Formatting only: no aggregation decisions live here. */

export function formatValue(value: number, unit: string): string {
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (unit === "seconds") {
    const m = Math.floor(value / 60);
    const s = Math.round(value % 60);
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  if (unit === "currency") {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  return compactNumber(value);
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(0)}K`;
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}K`;
  // Ranking positions and rates need a decimal; counts do not.
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
}

export interface Delta {
  pct: number;
  direction: "up" | "down" | "flat";
  /** True when the movement is good, accounting for metrics where lower wins. */
  isGood: boolean;
}

export function computeDelta(
  current: number,
  previous: number | null,
  higherIsBetter: boolean,
): Delta | null {
  // A zero baseline makes percentage change undefined, not infinite.
  if (previous === null || previous === 0) return null;

  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.05) return { pct: 0, direction: "flat", isGood: true };

  const direction = pct > 0 ? "up" : "down";
  return { pct, direction, isGood: higherIsBetter ? pct > 0 : pct < 0 };
}

export function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}

/** Inclusive day range ending today, as YYYY-MM-DD in UTC. */
export function lastNDays(n: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - (n - 1) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
