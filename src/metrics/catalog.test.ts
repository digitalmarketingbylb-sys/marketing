import { describe, expect, it } from "vitest";
import { METRIC_CATALOG, aggregateSeries, getMetric } from "./catalog";

describe("metric catalog", () => {
  it("has no duplicate keys", () => {
    const keys = METRIC_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks the metrics where lower is better", () => {
    expect(getMetric("average_position").higherIsBetter).toBe(false);
    expect(getMetric("bounce_rate").higherIsBetter).toBe(false);
    expect(getMetric("clicks").higherIsBetter).toBe(true);
  });

  it("throws on an unknown key rather than returning undefined", () => {
    expect(() => getMetric("impresions")).toThrow(/Unknown metric key/);
  });
});

describe("aggregateSeries", () => {
  const points = [
    { date: "2026-08-01", value: 100 },
    { date: "2026-08-02", value: 200 },
    { date: "2026-08-03", value: 300 },
  ];

  it("sums flow metrics", () => {
    expect(aggregateSeries("impressions", points)).toBe(600);
  });

  it("averages rate metrics", () => {
    expect(aggregateSeries("ctr", points)).toBe(200);
  });

  it("takes the newest reading for snapshot metrics", () => {
    // The whole point: 3 days of follower counts is 300, not 600.
    expect(aggregateSeries("followers", points)).toBe(300);
  });

  it("takes the newest reading regardless of input order", () => {
    const shuffled = [points[2], points[0], points[1]];
    expect(aggregateSeries("followers", shuffled)).toBe(300);
  });

  it("does not mutate the caller's array", () => {
    const input = [...points];
    aggregateSeries("followers", input);
    expect(input.map((p) => p.date)).toEqual(points.map((p) => p.date));
  });

  it("returns null for an empty series", () => {
    expect(aggregateSeries("impressions", [])).toBeNull();
  });
});
