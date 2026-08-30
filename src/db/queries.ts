/**
 * Read layer for the dashboard.
 *
 * The one rule these queries enforce: a metric is collapsed the way its
 * catalog entry says, never the way the chart feels like. Followers sums
 * across accounts but takes the newest value per account; impressions sums
 * across both. Doing this in SQL keeps every surface consistent.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

export interface DateRange {
  start: string;
  end: string;
}

export interface KpiRow {
  metricKey: string;
  label: string;
  category: string;
  unit: string;
  higherIsBetter: boolean;
  value: number;
  previousValue: number | null;
}

/**
 * Headline numbers for a client over a range, plus the immediately preceding
 * range of equal length so the UI can show a trend.
 *
 * Only undimensioned facts count toward headlines. Breakdown rows (per query,
 * per channel group) share the same metric keys, and including them would
 * double-count every total.
 */
export async function getKpis(clientSlug: string, range: DateRange): Promise<KpiRow[]> {
  const rows = await db.execute<{
    metric_key: string;
    label: string;
    category: string;
    unit: string;
    higher_is_better: boolean;
    value: string | null;
    previous_value: string | null;
  }>(sql`
    with bounds as (
      select
        ${range.start}::date as cur_start,
        ${range.end}::date   as cur_end,
        (${range.start}::date - (${range.end}::date - ${range.start}::date + 1)) as prev_start,
        (${range.start}::date - 1)                                              as prev_end
    ),
    scoped as (
      select
        f.metric_key,
        f.channel_account_id,
        f.date,
        f.value,
        d.aggregation,
        d.label,
        d.category::text as category,
        d.unit,
        d.higher_is_better,
        case when f.date >= b.cur_start then 'current' else 'previous' end as bucket
      from metric_facts f
      join metric_definitions d on d.key = f.metric_key
      cross join bounds b
      join clients c on c.id = f.client_id
      where c.slug = ${clientSlug}
        and f.dimensions_hash = '0'
        and f.date between b.prev_start and b.cur_end
    ),
    ranked as (
      select *,
        row_number() over (
          partition by bucket, metric_key, channel_account_id order by date desc
        ) as rn
      from scoped
    ),
    collapsed as (
      select
        metric_key, label, category, unit, higher_is_better, aggregation, bucket,
        case aggregation
          when 'sum'  then sum(value)
          when 'avg'  then avg(value)
          when 'max'  then max(value)
          -- Snapshot: newest reading per account, then summed across accounts.
          when 'last' then sum(value) filter (where rn = 1)
        end as value
      from ranked
      group by metric_key, label, category, unit, higher_is_better, aggregation, bucket
    )
    select
      metric_key, label, category, unit, higher_is_better,
      max(value) filter (where bucket = 'current')  as value,
      max(value) filter (where bucket = 'previous') as previous_value
    from collapsed
    group by metric_key, label, category, unit, higher_is_better
    order by metric_key
  `);

  return rows.map((r) => ({
    metricKey: r.metric_key,
    label: r.label,
    category: r.category,
    unit: r.unit,
    higherIsBetter: r.higher_is_better,
    value: Number(r.value ?? 0),
    previousValue: r.previous_value === null ? null : Number(r.previous_value),
  }));
}

export interface TimeseriesPoint {
  date: string;
  channel: string;
  value: number;
}

/** Daily series for one metric, split by channel. */
export async function getTimeseries(
  clientSlug: string,
  metricKey: string,
  range: DateRange,
): Promise<TimeseriesPoint[]> {
  const rows = await db.execute<{ date: string; channel: string; value: string }>(sql`
    select
      f.date::text as date,
      a.channel::text as channel,
      sum(f.value) as value
    from metric_facts f
    join channel_accounts a on a.id = f.channel_account_id
    join clients c on c.id = f.client_id
    where c.slug = ${clientSlug}
      and f.metric_key = ${metricKey}
      and f.dimensions_hash = '0'
      and f.date between ${range.start}::date and ${range.end}::date
    group by f.date, a.channel
    order by f.date
  `);

  return rows.map((r) => ({ date: r.date, channel: r.channel, value: Number(r.value) }));
}

export interface ChannelTotal {
  channel: string;
  brand: string;
  value: number;
}

/** One metric broken out by channel and brand, for the comparison table. */
export async function getChannelBreakdown(
  clientSlug: string,
  metricKey: string,
  range: DateRange,
): Promise<ChannelTotal[]> {
  const rows = await db.execute<{ channel: string; brand: string; value: string }>(sql`
    with ranked as (
      select
        a.channel::text as channel,
        b.name as brand,
        f.channel_account_id,
        f.value,
        d.aggregation,
        row_number() over (
          partition by f.channel_account_id order by f.date desc
        ) as rn
      from metric_facts f
      join channel_accounts a on a.id = f.channel_account_id
      join brands b on b.id = a.brand_id
      join metric_definitions d on d.key = f.metric_key
      join clients c on c.id = f.client_id
      where c.slug = ${clientSlug}
        and f.metric_key = ${metricKey}
        and f.dimensions_hash = '0'
        and f.date between ${range.start}::date and ${range.end}::date
    )
    select channel, brand,
      case max(aggregation::text)
        when 'sum'  then sum(value)
        when 'avg'  then avg(value)
        when 'max'  then max(value)
        when 'last' then sum(value) filter (where rn = 1)
      end as value
    from ranked
    group by channel, brand
    order by value desc nulls last
  `);

  return rows.map((r) => ({
    channel: r.channel,
    brand: r.brand,
    value: Number(r.value ?? 0),
  }));
}

export interface AccountCoverage {
  id: string;
  displayName: string;
  channel: string;
  provider: string;
  brand: string;
  status: string;
  url: string | null;
  note: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  factCount: number;
}

/**
 * The coverage view: every account, whether it is actually feeding the
 * dashboard, and when it last did.
 *
 * This is deliberately prominent in the UI. A marketing dashboard that shows
 * zero without saying "this channel was never connected" is worse than no
 * dashboard, because zero reads as failure rather than absence.
 */
export async function getAccountCoverage(clientSlug: string): Promise<AccountCoverage[]> {
  const rows = await db.execute<{
    id: string;
    display_name: string;
    channel: string;
    provider: string;
    brand: string;
    status: string;
    url: string | null;
    note: string | null;
    last_sync_at: string | null;
    last_sync_status: string | null;
    fact_count: string;
  }>(sql`
    select
      a.id::text,
      a.display_name,
      a.channel::text  as channel,
      a.provider::text as provider,
      b.name           as brand,
      a.status::text   as status,
      a.url,
      a.config->>'note' as note,
      (
        select max(s.finished_at)::text
        from sync_runs s
        where s.channel_account_id = a.id and s.status in ('success', 'partial')
      ) as last_sync_at,
      (
        select s.status::text from sync_runs s
        where s.channel_account_id = a.id
        order by s.started_at desc limit 1
      ) as last_sync_status,
      (select count(*) from metric_facts f where f.channel_account_id = a.id) as fact_count
    from channel_accounts a
    join brands b on b.id = a.brand_id
    join clients c on c.id = a.client_id
    where c.slug = ${clientSlug}
    order by b.name, a.channel, a.display_name
  `);

  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    channel: r.channel,
    provider: r.provider,
    brand: r.brand,
    status: r.status,
    url: r.url,
    note: r.note,
    lastSyncAt: r.last_sync_at,
    lastSyncStatus: r.last_sync_status,
    factCount: Number(r.fact_count),
  }));
}

export interface TopQuery {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

/** Top search queries from Search Console's dimensioned facts. */
export async function getTopQueries(
  clientSlug: string,
  range: DateRange,
  limit = 10,
): Promise<TopQuery[]> {
  const rows = await db.execute<{
    query: string;
    clicks: string;
    impressions: string;
    position: string;
  }>(sql`
    select
      f.dimensions->>'query' as query,
      sum(f.value) filter (where f.metric_key = 'clicks')            as clicks,
      sum(f.value) filter (where f.metric_key = 'impressions')       as impressions,
      avg(f.value) filter (where f.metric_key = 'average_position')  as position
    from metric_facts f
    join clients c on c.id = f.client_id
    where c.slug = ${clientSlug}
      and f.dimensions ? 'query'
      and f.date between ${range.start}::date and ${range.end}::date
    group by f.dimensions->>'query'
    order by clicks desc nulls last
    limit ${limit}
  `);

  return rows.map((r) => ({
    query: r.query,
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    position: Number(r.position ?? 0),
  }));
}

export async function getClientBySlug(slug: string) {
  const rows = await db.execute<{ id: string; name: string; slug: string; timezone: string }>(sql`
    select id::text, name, slug, timezone from clients where slug = ${slug} limit 1
  `);
  return rows[0] ?? null;
}
