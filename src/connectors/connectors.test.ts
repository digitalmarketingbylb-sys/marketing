import { afterEach, describe, expect, it, vi } from "vitest";
import { hashDimensions } from "./types";
import { ga4DateToIso } from "./google-auth";
import { ga4Connector } from "./ga4";
import { searchConsoleConnector } from "./search-console";
import { METRIC_BY_KEY } from "@/metrics/catalog";

/* ------------------------------------------------------------------------ */

describe("hashDimensions", () => {
  it("is stable regardless of key order", () => {
    expect(hashDimensions({ a: "1", b: "2" })).toBe(hashDimensions({ b: "2", a: "1" }));
  });

  it("separates different values", () => {
    expect(hashDimensions({ query: "cfo" })).not.toBe(hashDimensions({ query: "cpa" }));
  });

  it("gives undimensioned facts a stable sentinel", () => {
    // The read layer filters headline numbers on this exact value.
    expect(hashDimensions({})).toBe("0");
    expect(hashDimensions()).toBe("0");
  });

  it("does not collide across key/value boundaries", () => {
    expect(hashDimensions({ ab: "c" })).not.toBe(hashDimensions({ a: "bc" }));
  });
});

describe("ga4DateToIso", () => {
  it("converts YYYYMMDD", () => {
    expect(ga4DateToIso("20260815")).toBe("2026-08-15");
  });

  it("rejects anything else rather than producing a bad date", () => {
    expect(() => ga4DateToIso("2026-08-15")).toThrow();
    expect(() => ga4DateToIso("")).toThrow();
  });
});

/* ------------------------------------------------------------------------ */

const CREDS = {
  type: "oauth2" as const,
  accessToken: "test-token",
  expiresAt: Date.now() + 3_600_000,
};

const CTX = {
  accountId: "acc-1",
  clientId: "cli-1",
  range: { start: "2026-08-01", end: "2026-08-02" },
  config: {},
  credentials: CREDS,
};

function mockFetchOnce(bodies: unknown[]) {
  let i = 0;
  return vi.fn(async () => {
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ga4Connector", () => {
  it("maps native metric names onto catalog keys and converts dates", async () => {
    const report = {
      metricHeaders: [{ name: "sessions" }, { name: "totalUsers" }],
      rows: [
        {
          dimensionValues: [{ value: "20260801" }],
          metricValues: [{ value: "120" }, { value: "95" }],
        },
      ],
    };
    // Second call is the channel-group breakdown.
    const breakdown = {
      metricHeaders: [{ name: "sessions" }],
      rows: [
        {
          dimensionValues: [{ value: "20260801" }, { value: "Organic Search" }],
          metricValues: [{ value: "70" }],
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchOnce([report, breakdown]));

    const result = await ga4Connector.fetch({ ...CTX, externalId: "123456" });

    expect(result.facts).toContainEqual({ metricKey: "sessions", date: "2026-08-01", value: 120 });
    expect(result.facts).toContainEqual({ metricKey: "users", date: "2026-08-01", value: 95 });
    expect(result.facts).toContainEqual({
      metricKey: "sessions",
      date: "2026-08-01",
      value: 70,
      dimensions: { channel_group: "Organic Search" },
    });
  });

  it("only emits keys that exist in the catalog", async () => {
    const report = {
      metricHeaders: [{ name: "sessions" }, { name: "someUnmappedMetric" }],
      rows: [
        {
          dimensionValues: [{ value: "20260801" }],
          metricValues: [{ value: "10" }, { value: "99" }],
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchOnce([report, { rows: [] }]));

    const result = await ga4Connector.fetch({ ...CTX, externalId: "123456" });
    for (const f of result.facts) expect(METRIC_BY_KEY.has(f.metricKey)).toBe(true);
  });

  it("warns instead of returning silent zeros when the property has no rows", async () => {
    vi.stubGlobal("fetch", mockFetchOnce([{ metricHeaders: [], rows: [] }, { rows: [] }]));
    const result = await ga4Connector.fetch({ ...CTX, externalId: "123456" });

    expect(result.facts).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/no rows/i);
  });

  it("declares only catalog metrics in `emits`", () => {
    for (const key of ga4Connector.emits) expect(METRIC_BY_KEY.has(key)).toBe(true);
  });
});

describe("searchConsoleConnector", () => {
  it("maps position onto average_position and keeps query breakdowns dimensioned", async () => {
    const daily = {
      rows: [{ keys: ["2026-08-01"], clicks: 12, impressions: 340, ctr: 0.035, position: 8.4 }],
    };
    const byQuery = {
      rows: [
        {
          keys: ["2026-08-01", "outsourced cfo chicago"],
          clicks: 5,
          impressions: 90,
          ctr: 0.055,
          position: 4.2,
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchOnce([daily, byQuery]));

    const result = await searchConsoleConnector.fetch({
      ...CTX,
      externalId: "https://www.frakfinance.com/",
    });

    expect(result.facts).toContainEqual({
      metricKey: "average_position",
      date: "2026-08-01",
      value: 8.4,
    });
    expect(result.facts).toContainEqual({
      metricKey: "clicks",
      date: "2026-08-01",
      value: 5,
      dimensions: { query: "outsourced cfo chicago" },
    });
    // Headline and breakdown rows must stay distinguishable, or totals double.
    const headlineClicks = result.facts.filter(
      (f) => f.metricKey === "clicks" && !f.dimensions,
    );
    expect(headlineClicks).toHaveLength(1);
    expect(headlineClicks[0].value).toBe(12);
  });

  it("warns that recent days are incomplete", async () => {
    vi.stubGlobal("fetch", mockFetchOnce([{ rows: [] }, { rows: [] }]));
    const today = new Date().toISOString().slice(0, 10);

    const result = await searchConsoleConnector.fetch({
      ...CTX,
      range: { start: today, end: today },
      externalId: "https://www.frakfinance.com/",
    });

    expect(result.warnings.join(" ")).toMatch(/lags/i);
  });

  it("declares only catalog metrics in `emits`", () => {
    for (const key of searchConsoleConnector.emits) expect(METRIC_BY_KEY.has(key)).toBe(true);
  });
});
