/**
 * Multi-tenant marketing performance schema.
 *
 * Design rules that everything else depends on:
 *
 * 1. `clientId` is on every business table. Frak Finance is client #1 of N,
 *    so tenancy is never retrofitted.
 *
 * 2. A client has BRANDS. Frak Finance posts as two identities — the company
 *    and Tom Dillon personally — and they must roll up together (agency view)
 *    and split apart (whose LinkedIn is working?).
 *
 * 3. `channel` (the marketing surface) is separate from `provider` (where the
 *    numbers come from). The website channel is fed by two providers, GA4 and
 *    Search Console. Collapsing them would make that unrepresentable.
 *
 * 4. All numbers land in ONE fact table keyed by a canonical `metricKey`.
 *    That is what makes a cross-channel dashboard possible at all: LinkedIn
 *    "impressions" and X "impressions" become the same row shape.
 *
 * 5. Every metric declares how it aggregates over time (see metricDefinitions).
 *    Followers is a snapshot; summing it across 30 days is nonsense. The
 *    registry makes that a data property, not something each chart re-decides.
 */
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ---------------------------------------------------------------- enums -- */

/** The marketing surface an audience actually sees. */
export const channelEnum = pgEnum("channel", [
  "website",
  "linkedin",
  "youtube",
  "x",
  "instagram",
  "facebook",
  "substack",
  "reddit",
  "quora",
]);

/** Where the numbers come from. One channel may have several. */
export const providerEnum = pgEnum("provider", [
  "ga4",
  "google_search_console",
  "linkedin_marketing",
  "youtube_data",
  "x_api",
  "meta_graph",
  "substack",
  "reddit_api",
  "quora",
  "manual_csv",
]);

/**
 * Whether an account can actually be collected from today.
 *  - active            credentials in place, syncing
 *  - pending_access    account exists, API access not yet granted (app review, token)
 *  - manual_only       platform exposes no usable API for this surface (see docs/channel-matrix.md)
 *  - not_established   client has not created the account yet (Reddit, Quora)
 */
export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "pending_access",
  "manual_only",
  "not_established",
]);

export const authTypeEnum = pgEnum("auth_type", [
  "oauth2",
  "service_account",
  "api_key",
  "manual",
]);

/**
 * How a metric collapses when you widen the date range.
 * Getting this wrong is the classic cross-channel dashboard bug.
 */
export const aggregationEnum = pgEnum("aggregation", [
  "sum", // flow: impressions, clicks, sessions
  "avg", // rate: engagement rate, CTR, average position
  "last", // snapshot: followers, subscribers — take the newest value in range
  "max",
]);

export const metricCategoryEnum = pgEnum("metric_category", [
  "reach",
  "engagement",
  "acquisition",
  "audience",
  "conversion",
]);

export const brandKindEnum = pgEnum("brand_kind", ["company", "person"]);

export const contentFormatEnum = pgEnum("content_format", [
  "post",
  "article",
  "video",
  "short",
  "newsletter",
  "page",
  "thread",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "idea",
  "draft",
  "review",
  "scheduled",
  "published",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "success",
  "partial",
  "failed",
]);

/* -------------------------------------------------------------- tenancy -- */

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** IANA zone. Frak Finance is Chicago; daily buckets must match the client's day. */
    timezone: text("timezone").notNull().default("America/Chicago"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("clients_slug_key").on(t.slug)],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: brandKindEnum("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("brands_client_slug_key").on(t.clientId, t.slug)],
);

/* ------------------------------------------------------------- accounts -- */

/** One collectable surface: "Frak Finance's LinkedIn company page". */
export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    provider: providerEnum("provider").notNull(),
    displayName: text("display_name").notNull(),
    /** @frakfinance, tom-dillon-cfa — human handle, not the API key. */
    handle: text("handle"),
    url: text("url"),
    /**
     * The provider's own identifier, and the join key for ingestion:
     * GA4 property id, Search Console site URL, LinkedIn org URN, YouTube channel id.
     * Null while status is not_established.
     */
    externalId: text("external_id"),
    status: accountStatusEnum("status").notNull().default("pending_access"),
    /** Per-account connector settings (property filters, default dimensions). */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Two clients may legitimately share a provider; the same external id twice
    // under one client is a duplicate account.
    uniqueIndex("channel_accounts_client_provider_external_key")
      .on(t.clientId, t.provider, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("channel_accounts_client_idx").on(t.clientId, t.channel),
  ],
);

/**
 * Credentials, one row per (client, provider). Secrets are AES-256-GCM
 * sealed by src/lib/crypto.ts — never stored or logged in plaintext.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    authType: authTypeEnum("auth_type").notNull(),
    encryptedCredentials: text("encrypted_credentials"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("connections_client_provider_key").on(t.clientId, t.provider)],
);

/* ------------------------------------------------------- metric registry -- */

/**
 * The canonical vocabulary. A connector may only emit keys that exist here,
 * which is what stops "engagements" and "total_engagement" from drifting apart
 * as channels are added.
 */
export const metricDefinitions = pgTable("metric_definitions", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  unit: text("unit").notNull().default("count"), // count | ratio | seconds | currency
  aggregation: aggregationEnum("aggregation").notNull(),
  category: metricCategoryEnum("category").notNull(),
  /** False for metrics where lower is better (bounce rate, average position). */
  higherIsBetter: boolean("higher_is_better").notNull().default(true),
});

/* ----------------------------------------------------------------- facts -- */

/**
 * The unified daily fact table — every channel, every metric, one shape.
 *
 * Grain: (channelAccountId, metricKey, date, dimensionsHash).
 * The unique index on that grain makes re-syncing idempotent: a daily job can
 * re-pull a window and upsert without double-counting.
 */
export const metricFacts = pgTable(
  "metric_facts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    metricKey: text("metric_key")
      .notNull()
      .references(() => metricDefinitions.key),
    /** Day in the CLIENT's timezone, not UTC. */
    date: date("date").notNull(),
    value: numeric("value", { precision: 20, scale: 4 }).notNull(),
    /** Optional breakdown: {country:"US"}, {query:"outsourced cfo chicago"}. */
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),
    /**
     * Stable digest of `dimensions`. Postgres cannot put jsonb in a unique
     * index directly, so the connector computes this (src/connectors/types.ts)
     * and it carries the uniqueness.
     */
    dimensionsHash: text("dimensions_hash").notNull(),
    provider: providerEnum("provider").notNull(),
    syncRunId: uuid("sync_run_id"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("metric_facts_grain_key").on(
      t.channelAccountId,
      t.metricKey,
      t.date,
      t.dimensionsHash,
    ),
    // Drives the dashboard's default query: one client, a date window.
    index("metric_facts_client_date_idx").on(t.clientId, t.date),
    index("metric_facts_account_metric_date_idx").on(t.channelAccountId, t.metricKey, t.date),
  ],
);

/* --------------------------------------------------------------- content -- */

/** A post, page, video or newsletter issue — the unit editorial actually plans. */
export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    /** Provider's post id / page path / video id. Null until published. */
    externalId: text("external_id"),
    url: text("url"),
    title: text("title"),
    format: contentFormatEnum("format").notNull().default("post"),
    status: contentStatusEnum("status").notNull().default("idea"),
    /** Editorial pillar — the worksheet's Educational / Thought Leadership / Event Coverage. */
    topicPillar: text("topic_pillar"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("content_items_account_external_key")
      .on(t.channelAccountId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("content_items_client_published_idx").on(t.clientId, t.publishedAt),
  ],
);

/** Per-post performance over time. Same grain discipline as metricFacts. */
export const contentMetricFacts = pgTable(
  "content_metric_facts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    metricKey: text("metric_key")
      .notNull()
      .references(() => metricDefinitions.key),
    date: date("date").notNull(),
    value: numeric("value", { precision: 20, scale: 4 }).notNull(),
    dimensions: jsonb("dimensions").notNull().default(sql`'{}'::jsonb`),
    dimensionsHash: text("dimensions_hash").notNull(),
    provider: providerEnum("provider").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("content_metric_facts_grain_key").on(
      t.contentItemId,
      t.metricKey,
      t.date,
      t.dimensionsHash,
    ),
    index("content_metric_facts_client_date_idx").on(t.clientId, t.date),
  ],
);

/* --------------------------------------------------------------- targets -- */

/** What "good" looks like, so the dashboard can show performance vs a goal. */
export const metricTargets = pgTable(
  "metric_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Null = the target applies across every channel. */
    channel: channelEnum("channel"),
    metricKey: text("metric_key")
      .notNull()
      .references(() => metricDefinitions.key),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    targetValue: numeric("target_value", { precision: 20, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("metric_targets_client_metric_idx").on(t.clientId, t.metricKey)],
);

/* ------------------------------------------------------------------ ops -- */

/** Ingestion audit trail. Answers "is this dashboard number stale, or is it zero?" */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id").references(() => channelAccounts.id, {
      onDelete: "cascade",
    }),
    provider: providerEnum("provider").notNull(),
    status: syncStatusEnum("status").notNull().default("running"),
    rangeStart: date("range_start"),
    rangeEnd: date("range_end"),
    rowsWritten: integer("rows_written").notNull().default(0),
    warnings: text("warnings").array().notNull().default(sql`'{}'::text[]`),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_client_started_idx").on(t.clientId, t.startedAt)],
);

/* ------------------------------------------------------------ relations -- */

export const clientsRelations = relations(clients, ({ many }) => ({
  brands: many(brands),
  channelAccounts: many(channelAccounts),
  connections: many(connections),
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  client: one(clients, { fields: [brands.clientId], references: [clients.id] }),
  channelAccounts: many(channelAccounts),
}));

export const channelAccountsRelations = relations(channelAccounts, ({ one, many }) => ({
  client: one(clients, { fields: [channelAccounts.clientId], references: [clients.id] }),
  brand: one(brands, { fields: [channelAccounts.brandId], references: [brands.id] }),
  facts: many(metricFacts),
  content: many(contentItems),
}));

export const metricFactsRelations = relations(metricFacts, ({ one }) => ({
  account: one(channelAccounts, {
    fields: [metricFacts.channelAccountId],
    references: [channelAccounts.id],
  }),
  definition: one(metricDefinitions, {
    fields: [metricFacts.metricKey],
    references: [metricDefinitions.key],
  }),
}));

export const contentItemsRelations = relations(contentItems, ({ one, many }) => ({
  account: one(channelAccounts, {
    fields: [contentItems.channelAccountId],
    references: [channelAccounts.id],
  }),
  metrics: many(contentMetricFacts),
}));

/* ---------------------------------------------------------------- types -- */

export type Channel = (typeof channelEnum.enumValues)[number];
export type Provider = (typeof providerEnum.enumValues)[number];
export type AccountStatus = (typeof accountStatusEnum.enumValues)[number];
export type Aggregation = (typeof aggregationEnum.enumValues)[number];
export type ChannelAccount = typeof channelAccounts.$inferSelect;
export type MetricFact = typeof metricFacts.$inferSelect;
export type NewMetricFact = typeof metricFacts.$inferInsert;
