# Marketing Performance Platform

Cross-channel marketing performance, consolidated into one schema and one
dashboard. Built for Frak Finance as client #1; multi-tenant from the first
migration.

Instead of opening GA4, Search Console, LinkedIn, YouTube Studio, X and
Instagram separately and reconciling six definitions of "engagement" by hand,
every channel writes into one fact table with one metric vocabulary.

## Status

**Foundation, with the website channel wired end-to-end.**

| Piece | State |
|---|---|
| Multi-tenant schema (10 tables) | Done, migrated |
| Canonical metric catalog (24 metrics) | Done |
| Connector framework | Done |
| GA4 connector | Done |
| Search Console connector | Done |
| Dashboard: KPIs, trend, coverage, top queries | Done |
| Frak Finance channel inventory (16 accounts, 2 brands) | Seeded |
| Live data | **Blocked on credentials** — see below |

No channel is syncing yet. The pipeline is built; every account is waiting on
credentials or platform access. The dashboard says so rather than showing
zeros.

## Quickstart

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and ENCRYPTION_KEY
openssl rand -base64 32       # -> ENCRYPTION_KEY

npm run db:migrate
npm run db:seed               # metric catalog + Frak Finance inventory
npm run dev
```

To see the dashboard populated before real credentials exist, seed a
**separate** demo tenant — never mixed into a real client:

```bash
npm run demo:seed
DEFAULT_CLIENT_SLUG=demo-co npm run dev
npm run demo:drop
```

## Connecting the website channel

GA4 and Search Console are built first because they need no app review and no
budget:

1. In Google Cloud, create a service account; enable the **Analytics Data
   API** and the **Search Console API**.
2. Add the service-account email as a **Viewer** on the GA4 property and a
   **restricted user** on the Search Console property.
3. Store the credentials in `connections` (sealed with AES-256-GCM via
   `src/lib/crypto.ts`).
4. Set each account's `externalId` — the numeric GA4 property id, and the
   exact verified Search Console property URL.
5. Flip the account `status` to `active`.

```bash
npm run sync                  # last 7 days
npm run sync -- --days 90     # backfill
```

Re-running is safe: writes upsert on the fact grain, so a re-pull of days a
provider has since restated overwrites rather than double-counts.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dashboard at localhost:3000 |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Metric catalog + client inventory (idempotent) |
| `npm run sync` | Pull metrics for active accounts |
| `npm test` | Unit + integration tests (needs a migrated database) |
| `npm run typecheck` | `tsc --noEmit` |

## Layout

```
src/
  db/
    schema.ts        multi-tenant schema; read this first
    queries.ts       read layer, applies aggregation semantics in SQL
    seed.ts          metric catalog + Frak Finance channel inventory
  metrics/
    catalog.ts       the canonical metric vocabulary
  connectors/
    types.ts         the Connector contract
    registry.ts      wired connectors, validated at import
    run.ts           sync orchestration + idempotent upsert
    ga4.ts           Google Analytics 4
    search-console.ts
  app/               Next.js dashboard
docs/
  architecture.md    design decisions and why
  channel-matrix.md  per-channel API reality, costs, and the three walls
```

## Read next

- **[docs/architecture.md](docs/architecture.md)** — the four ideas the design
  rests on, and what was deliberately deferred.
- **[docs/channel-matrix.md](docs/channel-matrix.md)** — what each remaining
  channel needs, and the three that have no API at all.
