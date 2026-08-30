# Architecture

## The problem

Each platform reports on itself. Answering "how did marketing do last month?"
means opening GA4, Search Console, LinkedIn, YouTube Studio, X and Instagram
separately, and then reconciling six definitions of "engagement" by hand.

This is a pipeline that pulls those platforms into one schema, plus a
dashboard on top of it. The dashboard is the visible part; the schema is the
part that decides whether outbound, attribution and agent workflows can be
added later without a rewrite.

## Shape

```
Provider APIs ──> Connector ──> metric_facts ──> queries ──> Dashboard
                     │              │
                (one file      (one row shape
                 per channel)   for every channel)
```

Four ideas carry the design.

### 1. Tenancy is in the schema from row one

`clientId` is on every business table. Frak Finance is client #1 of N. Adding
client #2 means inserting rows, not migrating tables.

### 2. Channel and provider are separate

A **channel** is a surface an audience sees. A **provider** is where numbers
come from. The website channel has two providers — GA4 for on-site behaviour,
Search Console for search acquisition — and neither can answer the other's
questions. Collapsing them would make that unrepresentable.

### 3. One fact table, one metric vocabulary

Every number lands in `metric_facts`, keyed by a canonical `metricKey` from
`src/metrics/catalog.ts`. LinkedIn's `impressionCount`, X's `impression_count`
and Search Console's `impressions` all become `impressions`. Without that,
there is no such thing as a cross-channel chart — only six charts side by side.

The grain is `(channelAccountId, metricKey, date, dimensionsHash)`, unique.
Breakdowns (per search query, per traffic source) reuse the same metric keys
with a populated `dimensions` map, so a new breakdown never needs a new table.

### 4. Every metric declares how it aggregates

This is the part that is easy to skip and expensive to skip.

Widen a date range and metrics behave differently. Impressions add up.
Engagement rate averages. **Follower count does neither** — it is a snapshot,
and the value for a range is the newest reading, not the sum. Summing a
follower count across 30 days produces a number 30× too large that still looks
plausible on a slide.

So `aggregation` is a property of the metric (`sum` / `avg` / `last` / `max`),
read by the SQL in `src/db/queries.ts` and by `aggregateSeries()`. No chart
decides this for itself. `src/db/queries.test.ts` asserts it against a real
database, including the case that matters: followers across two accounts
collapses to *newest per account, then summed*.

## Idempotent ingestion

Providers restate recent days — Search Console in particular lags roughly
three days and revises upward. So the nightly job re-pulls a trailing window
rather than only yesterday, and the write is an upsert on the fact grain:
last write wins, re-runs are free, and no double counting.

`sync_runs` records every attempt with its warnings. That is what lets the UI
distinguish "this channel reported zero" from "this channel has never been
connected" — a distinction that decides whether someone panics about a number.

## Honest empty states

A dashboard showing zeros for an unconnected channel is worse than no
dashboard: zero reads as failure when the truth is absence. Account status
(`active` / `pending_access` / `manual_only` / `not_established`) is
first-class in the schema and the coverage table leads the UI. Tiles with no
data render an em dash and "not connected", never `0`.

## Adding a channel

1. Write `src/connectors/<provider>.ts` implementing `Connector`.
2. Map the provider's native metric names onto catalog keys. Add new keys to
   `METRIC_CATALOG` if needed — with the right `aggregation`.
3. Register it in `src/connectors/registry.ts`.

No schema migration, no dashboard change. The registry validates at import
time that every declared metric exists in the catalog, so a typo fails at
startup rather than as a foreign-key error halfway through a nightly sync.

## Deliberately deferred

- **Auth and user accounts.** Single-tenant UI over a multi-tenant schema.
- **Scheduling.** `npm run sync` is manual; it wants cron or a queue.
- **Content-level metrics.** `content_items` and `content_metric_facts` exist
  and are unused. They are where the client's posting calendar and per-post
  performance will live, joining plan to result.
- **Attribution.** No cross-channel journey modelling. `meetings_booked` is
  defined in the catalog but has no source until Calendly is wired.
