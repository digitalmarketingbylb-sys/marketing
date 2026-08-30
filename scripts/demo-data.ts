/**
 * Generates a SEPARATE demo tenant with synthetic facts.
 *
 *   npm run demo:seed     create / refresh the demo tenant
 *   npm run demo:drop     remove it
 *
 * Deliberately its own client ("demo-co"), never Frak Finance. Real client
 * dashboards must stay empty until real credentials produce real numbers;
 * mixing sample data into them is how a screenshot ends up in a client
 * meeting presented as fact.
 *
 * View it with DEFAULT_CLIENT_SLUG=demo-co npm run dev
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hashDimensions } from "@/connectors/types";

const SLUG = "demo-co";
const DAYS = 30;

interface Surface {
  channel: string;
  provider: string;
  name: string;
  base: number;
  growth: number;
  followers: number;
}

const SURFACES: Surface[] = [
  { channel: "website", provider: "ga4", name: "Demo site (GA4)", base: 210, growth: 1.9, followers: 0 },
  { channel: "linkedin", provider: "linkedin_marketing", name: "Demo LinkedIn", base: 145, growth: 3.1, followers: 4820 },
  { channel: "youtube", provider: "youtube_data", name: "Demo YouTube", base: 62, growth: 1.4, followers: 1140 },
  { channel: "x", provider: "x_api", name: "Demo X", base: 48, growth: 0.6, followers: 990 },
  { channel: "instagram", provider: "meta_graph", name: "Demo Instagram", base: 38, growth: 0.9, followers: 760 },
];

/** Deterministic pseudo-random so repeated runs give the same chart. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

async function drop() {
  await db.execute(sql`delete from clients where slug = ${SLUG}`);
  console.log(`Removed demo tenant "${SLUG}".`);
}

async function seed() {
  await drop();

  const [client] = await db.execute<{ id: string }>(sql`
    insert into clients (slug, name, timezone)
    values (${SLUG}, 'Demo Co (sample data)', 'America/Chicago')
    returning id::text
  `);
  const [brand] = await db.execute<{ id: string }>(sql`
    insert into brands (client_id, slug, name, kind)
    values (${client.id}::uuid, 'demo', 'Demo Co', 'company')
    returning id::text
  `);

  const today = new Date();
  let rows = 0;

  for (const [s, surface] of SURFACES.entries()) {
    const [account] = await db.execute<{ id: string }>(sql`
      insert into channel_accounts
        (client_id, brand_id, channel, provider, display_name, status, external_id)
      values (
        ${client.id}::uuid, ${brand.id}::uuid,
        ${surface.channel}::channel, ${surface.provider}::provider,
        ${surface.name}, 'active', ${`demo-${s}`}
      )
      returning id::text
    `);

    for (let d = DAYS - 1; d >= 0; d--) {
      const date = new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10);
      const day = DAYS - d;
      const weekend = [0, 6].includes(new Date(date).getUTCDay());
      const seasonal = weekend ? 0.55 : 1;

      const sessions = Math.round(
        (surface.base + day * surface.growth) * seasonal * (0.8 + noise(s * 100 + day) * 0.4),
      );
      const impressions = sessions * (6 + Math.round(noise(s * 7 + day) * 5));
      const engagements = Math.round(impressions * (0.02 + noise(s * 13 + day) * 0.03));
      const clicks = Math.round(impressions * (0.01 + noise(s * 17 + day) * 0.02));

      const facts: [string, number][] = [
        ["impressions", impressions],
        ["engagements", engagements],
        ["clicks", clicks],
      ];
      // Sessions is a website metric; emitting it for LinkedIn or YouTube
      // would be fake data that happens to render.
      if (surface.channel === "website") facts.push(["sessions", sessions]);
      if (surface.followers > 0) {
        // Snapshot metric: grows steadily, must not be summed by the read layer.
        facts.push(["followers", surface.followers + day * 6 + Math.round(noise(s + day) * 8)]);
      }

      for (const [metricKey, value] of facts) {
        await db.execute(sql`
          insert into metric_facts
            (client_id, channel_account_id, metric_key, date, value,
             dimensions, dimensions_hash, provider)
          values (
            ${client.id}::uuid, ${account.id}::uuid, ${metricKey}, ${date}::date, ${value},
            '{}'::jsonb, ${hashDimensions({})}, ${surface.provider}::provider
          )
          on conflict do nothing
        `);
        rows++;
      }
    }
  }

  console.log(`Demo tenant "${SLUG}" created: ${SURFACES.length} accounts, ${rows} facts.`);
  console.log(`View with: DEFAULT_CLIENT_SLUG=${SLUG} npm run dev`);
}

const action = process.argv.includes("--drop") ? drop : seed;
action()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
