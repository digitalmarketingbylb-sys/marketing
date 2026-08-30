/**
 * The canonical metric vocabulary.
 *
 * Every connector maps its provider's native metric names onto these keys.
 * LinkedIn "impressionCount", X "impression_count" and Search Console
 * "impressions" all become `impressions` — which is the only reason a single
 * cross-channel chart can exist.
 *
 * `aggregation` is the important column. It says what happens when a user
 * widens the date range:
 *   sum   flow      30 days of impressions add up
 *   avg   rate      30 days of CTR average out
 *   last  snapshot  30 days of follower counts collapse to the newest one
 *
 * Charts must read this, never assume. Summing a follower count across a month
 * produces a number 30x too large, and it looks plausible enough to ship.
 */
import type { Aggregation } from "@/db/schema";

export type MetricCategory =
  | "reach"
  | "engagement"
  | "acquisition"
  | "audience"
  | "conversion";

export interface MetricDefinition {
  key: string;
  label: string;
  description: string;
  unit: "count" | "ratio" | "seconds" | "currency";
  aggregation: Aggregation;
  category: MetricCategory;
  higherIsBetter: boolean;
}

export const METRIC_CATALOG: MetricDefinition[] = [
  /* ------------------------------------------------------------- reach -- */
  {
    key: "impressions",
    label: "Impressions",
    description: "Times content was displayed. Additive across days.",
    unit: "count",
    aggregation: "sum",
    category: "reach",
    higherIsBetter: true,
  },
  {
    key: "reach",
    label: "Reach",
    description:
      "Unique accounts that saw the content. NON-ADDITIVE: summing daily reach " +
      "over-counts anyone who saw it on more than one day. Treated as sum for " +
      "trend shape; pull a range-level figure from the provider for exact totals.",
    unit: "count",
    aggregation: "sum",
    category: "reach",
    higherIsBetter: true,
  },

  /* -------------------------------------------------------- engagement -- */
  {
    key: "engagements",
    label: "Engagements",
    description: "All interactions: reactions, comments, shares, saves, clicks on media.",
    unit: "count",
    aggregation: "sum",
    category: "engagement",
    higherIsBetter: true,
  },
  {
    key: "likes",
    label: "Likes / Reactions",
    description: "Positive reactions on a piece of content.",
    unit: "count",
    aggregation: "sum",
    category: "engagement",
    higherIsBetter: true,
  },
  {
    key: "comments",
    label: "Comments",
    description: "Replies left on a piece of content.",
    unit: "count",
    aggregation: "sum",
    category: "engagement",
    higherIsBetter: true,
  },
  {
    key: "shares",
    label: "Shares / Reposts",
    description: "Reposts, retweets, or shares to another surface.",
    unit: "count",
    aggregation: "sum",
    category: "engagement",
    higherIsBetter: true,
  },
  {
    key: "engagement_rate",
    label: "Engagement Rate",
    description: "Engagements divided by impressions. Averaged, never summed.",
    unit: "ratio",
    aggregation: "avg",
    category: "engagement",
    higherIsBetter: true,
  },
  {
    key: "video_views",
    label: "Video Views",
    description: "Counted per each platform's own view threshold — not comparable 1:1 across channels.",
    unit: "count",
    aggregation: "sum",
    category: "engagement",
    higherIsBetter: true,
  },
  {
    key: "watch_time_minutes",
    label: "Watch Time",
    description: "Total minutes watched.",
    unit: "count",
    aggregation: "sum",
    category: "engagement",
    higherIsBetter: true,
  },

  /* ------------------------------------------------------- acquisition -- */
  {
    key: "clicks",
    label: "Clicks",
    description: "Clicks through to a destination — search results, link in post, CTA.",
    unit: "count",
    aggregation: "sum",
    category: "acquisition",
    higherIsBetter: true,
  },
  {
    key: "sessions",
    label: "Sessions",
    description: "Website visits (GA4).",
    unit: "count",
    aggregation: "sum",
    category: "acquisition",
    higherIsBetter: true,
  },
  {
    key: "users",
    label: "Users",
    description:
      "Distinct visitors. NON-ADDITIVE across days for the same reason as reach — " +
      "a returning visitor counts once per day.",
    unit: "count",
    aggregation: "sum",
    category: "acquisition",
    higherIsBetter: true,
  },
  {
    key: "new_users",
    label: "New Users",
    description: "First-time visitors (GA4).",
    unit: "count",
    aggregation: "sum",
    category: "acquisition",
    higherIsBetter: true,
  },
  {
    key: "pageviews",
    label: "Page Views",
    description: "Total pages viewed.",
    unit: "count",
    aggregation: "sum",
    category: "acquisition",
    higherIsBetter: true,
  },
  {
    key: "ctr",
    label: "Click-Through Rate",
    description: "Clicks divided by impressions.",
    unit: "ratio",
    aggregation: "avg",
    category: "acquisition",
    higherIsBetter: true,
  },
  {
    key: "average_position",
    label: "Average Search Position",
    description: "Mean ranking in Google results. Lower is better — position 1 beats position 20.",
    unit: "count",
    aggregation: "avg",
    category: "acquisition",
    higherIsBetter: false,
  },
  {
    key: "bounce_rate",
    label: "Bounce Rate",
    description: "Share of sessions that left without engaging.",
    unit: "ratio",
    aggregation: "avg",
    category: "acquisition",
    higherIsBetter: false,
  },
  {
    key: "average_session_duration",
    label: "Avg. Session Duration",
    description: "Mean seconds per session.",
    unit: "seconds",
    aggregation: "avg",
    category: "acquisition",
    higherIsBetter: true,
  },

  /* ---------------------------------------------------------- audience -- */
  {
    key: "followers",
    label: "Followers",
    description:
      "Total audience size at a point in time. SNAPSHOT — the value for a date " +
      "range is the newest reading, never the sum.",
    unit: "count",
    aggregation: "last",
    category: "audience",
    higherIsBetter: true,
  },
  {
    key: "net_new_followers",
    label: "Net New Followers",
    description: "Gained minus lost. This is the additive counterpart to `followers`.",
    unit: "count",
    aggregation: "sum",
    category: "audience",
    higherIsBetter: true,
  },
  {
    key: "subscribers",
    label: "Subscribers",
    description: "Newsletter or YouTube subscriber count. Snapshot, like followers.",
    unit: "count",
    aggregation: "last",
    category: "audience",
    higherIsBetter: true,
  },
  {
    key: "profile_views",
    label: "Profile Views",
    description: "Visits to the profile or channel page itself.",
    unit: "count",
    aggregation: "sum",
    category: "audience",
    higherIsBetter: true,
  },

  /* -------------------------------------------------------- conversion -- */
  {
    key: "conversions",
    label: "Conversions",
    description: "Key events: form fills, demo requests, qualified actions.",
    unit: "count",
    aggregation: "sum",
    category: "conversion",
    higherIsBetter: true,
  },
  {
    key: "meetings_booked",
    label: "Meetings Booked",
    description:
      "Calendly bookings. The metric that actually matters for Frak Finance — " +
      "everything upstream is a leading indicator of this.",
    unit: "count",
    aggregation: "sum",
    category: "conversion",
    higherIsBetter: true,
  },
];

export const METRIC_BY_KEY: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_CATALOG.map((m) => [m.key, m]),
);

export function getMetric(key: string): MetricDefinition {
  const m = METRIC_BY_KEY.get(key);
  if (!m) throw new Error(`Unknown metric key "${key}". Add it to METRIC_CATALOG first.`);
  return m;
}

/**
 * Collapse a day-series into one number using the metric's declared semantics.
 * Every KPI tile and summary number goes through here.
 */
export function aggregateSeries(
  key: string,
  points: { date: string; value: number }[],
): number | null {
  if (points.length === 0) return null;
  const { aggregation } = getMetric(key);
  switch (aggregation) {
    case "sum":
      return points.reduce((a, p) => a + p.value, 0);
    case "avg":
      return points.reduce((a, p) => a + p.value, 0) / points.length;
    case "max":
      return Math.max(...points.map((p) => p.value));
    case "last": {
      // Newest reading wins — do not mutate the caller's array.
      const newest = points.reduce((a, p) => (p.date > a.date ? p : a));
      return newest.value;
    }
  }
}
