"use client";

import { useMemo, useState } from "react";
import {
  CHANNEL_GROUP,
  CHANNEL_LABEL,
  channelColorVar,
  type ChannelGroup,
} from "@/lib/channels";
import type { Channel } from "@/db/schema";
import { compactNumber, formatDateShort } from "@/lib/format";

export interface TrendPoint {
  date: string;
  channel: string;
  value: number;
}

interface Props {
  title: string;
  points: TrendPoint[];
  /** Rendered when there is nothing to plot, instead of an empty axis box. */
  emptyState: React.ReactNode;
}

const W = 900;
const H = 280;
const PAD = { top: 16, right: 96, bottom: 32, left: 56 };

/**
 * Round the axis top up to a readable step, so ticks land on 75/150/225/300
 * rather than 70/141/211/281. Purely presentational: the plotted values are
 * untouched.
 */
function niceAxis(max: number, tickCount = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };

  const rawStep = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  // 1, 2, 2.5, 5, 10 give steps whose multiples read cleanly.
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;

  const top = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = 0; v <= top + niceStep / 2; v += niceStep) ticks.push(v);
  return { top, ticks };
}

/**
 * Multi-series daily trend.
 *
 * Single y-axis by construction: every series is the same metric in the same
 * unit, so the dual-axis trap cannot arise here.
 *
 * Light-mode slots 3-5 sit below 3:1 against the surface, so the relief rule
 * applies: series are direct-labelled at the line end (up to 4 series) and a
 * table view is always one click away. Identity never rests on color alone.
 */
export function TrendChart({ title, points, emptyState }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const { dates, series, yMax } = useMemo(() => {
    const dateSet = [...new Set(points.map((p) => p.date))].sort();

    // Merge raw channels into display groups (Instagram + Facebook -> Meta).
    const byGroup = new Map<ChannelGroup, Map<string, number>>();
    for (const p of points) {
      const group = CHANNEL_GROUP[p.channel as Channel] ?? "website";
      if (!byGroup.has(group)) byGroup.set(group, new Map());
      const m = byGroup.get(group)!;
      m.set(p.date, (m.get(p.date) ?? 0) + p.value);
    }

    // Order by total so the legend reads sensibly, but color comes from the
    // fixed slot map, never from this ordering.
    const built = [...byGroup.entries()]
      .map(([group, m]) => ({
        group,
        label: CHANNEL_LABEL[group],
        color: channelColorVar(group),
        values: dateSet.map((d) => m.get(d) ?? 0),
        total: [...m.values()].reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);

    const max = Math.max(1, ...built.flatMap((s) => s.values));
    return { dates: dateSet, series: built, yMax: max };
  }, [points]);

  if (points.length === 0) {
    return (
      <section
        className="rounded-lg p-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
        <div className="mt-4">{emptyState}</div>
      </section>
    );
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const { top: axisTop, ticks } = niceAxis(yMax);
  const x = (i: number) => PAD.left + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / axisTop) * plotH;

  const labelEvery = Math.max(1, Math.ceil(dates.length / 8));

  return (
    <section
      className="rounded-lg p-5"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-xs underline underline-offset-2"
          style={{ color: "var(--text-secondary)" }}
        >
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {/* Legend is always present for 2+ series; identity is never color-only. */}
      {series.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.group} className="flex items-center gap-1.5 text-xs"
                  style={{ color: "var(--text-secondary)" }}>
              <span
                aria-hidden
                style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: s.color, display: "inline-block",
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {showTable ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs tabular">
            <thead>
              <tr style={{ color: "var(--text-secondary)" }}>
                <th className="py-1.5 pr-4 text-left font-medium">Date</th>
                {series.map((s) => (
                  <th key={s.group} className="py-1.5 pr-4 text-right font-medium">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((d, i) => (
                <tr key={d} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-1.5 pr-4" style={{ color: "var(--text-secondary)" }}>{d}</td>
                  {series.map((s) => (
                    <td key={s.group} className="py-1.5 pr-4 text-right"
                        style={{ color: "var(--text-primary)" }}>
                      {compactNumber(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label={`${title}. Table view available via the Show table control.`}
            style={{ display: "block", minWidth: 560 }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            {/* Recessive grid */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                      stroke="var(--grid)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end"
                      fontSize={11} fill="var(--text-muted)" className="tabular">
                  {compactNumber(t)}
                </text>
              </g>
            ))}
            <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)}
                  stroke="var(--axis)" strokeWidth={1} />

            {dates.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={d} x={x(i)} y={H - 10} textAnchor="middle"
                      fontSize={11} fill="var(--text-muted)">
                  {formatDateShort(d)}
                </text>
              ) : null,
            )}

            {/* 2px lines */}
            {series.map((s) => (
              <path
                key={s.group}
                d={s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* Direct labels at the line end - the relief for low-contrast slots. */}
            {series.length <= 4 &&
              series.map((s) => (
                <text
                  key={s.group}
                  x={W - PAD.right + 8}
                  y={y(s.values[s.values.length - 1]) + 4}
                  fontSize={11}
                  fill="var(--text-secondary)"
                >
                  {s.label}
                </text>
              ))}

            {/* Crosshair + markers on hover */}
            {hoverIndex !== null && (
              <>
                <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={PAD.top} y2={PAD.top + plotH}
                      stroke="var(--axis)" strokeWidth={1} />
                {series.map((s) => (
                  <circle
                    key={s.group}
                    cx={x(hoverIndex)}
                    cy={y(s.values[hoverIndex])}
                    r={4.5}
                    fill={s.color}
                    /* 2px surface ring keeps overlapping markers separable */
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                ))}
              </>
            )}

            {/* Hit targets, wider than the marks */}
            {dates.map((d, i) => (
              <rect
                key={d}
                x={x(i) - plotW / Math.max(1, dates.length - 1) / 2}
                y={PAD.top}
                width={plotW / Math.max(1, dates.length - 1)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
              />
            ))}
          </svg>

          {hoverIndex !== null && (
            <div
              className="mt-2 inline-block rounded-md px-3 py-2 text-xs"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
            >
              <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                {dates[hoverIndex]}
              </div>
              {series.map((s) => (
                <div key={s.group} className="mt-1 flex items-center gap-2">
                  <span aria-hidden style={{
                    width: 8, height: 8, borderRadius: 2,
                    background: s.color, display: "inline-block",
                  }} />
                  <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
                  <span className="tabular" style={{ color: "var(--text-primary)" }}>
                    {compactNumber(s.values[hoverIndex])}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
