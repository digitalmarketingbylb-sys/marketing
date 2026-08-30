/**
 * Seeds the metric catalog and Frak Finance's channel inventory.
 *
 * Idempotent: safe to re-run after adding an account or a metric.
 *
 * The inventory below is transcribed from the client's channel sheet. Two
 * brands share one client because Frak Finance publishes both as the company
 * and as Tom Dillon personally, and the two have to roll up together for a
 * board-level view and split apart for an editorial one.
 *
 * `status` records collection reality, not aspiration:
 *   pending_access    API exists; credentials or approval not in place yet
 *   manual_only       the platform exposes no usable analytics API at all
 *   not_established   the client has not created the account yet
 */
import { db } from "./index";
import {
  brands,
  channelAccounts,
  clients,
  metricDefinitions,
  type AccountStatus,
  type Channel,
  type Provider,
} from "./schema";
import { METRIC_CATALOG } from "@/metrics/catalog";
import { eq, and } from "drizzle-orm";

interface AccountSeed {
  brand: "frak-finance" | "tom-dillon";
  channel: Channel;
  provider: Provider;
  displayName: string;
  handle?: string;
  url?: string;
  status: AccountStatus;
  note?: string;
}

const ACCOUNTS: AccountSeed[] = [
  /* ------------------------------------------------- Frak Finance, company -- */
  {
    brand: "frak-finance",
    channel: "website",
    provider: "ga4",
    displayName: "frakfinance.com (GA4)",
    url: "https://www.frakfinance.com/",
    status: "pending_access",
    note: "Add the service-account email as a Viewer on the GA4 property, then set externalId to the numeric property id.",
  },
  {
    brand: "frak-finance",
    channel: "website",
    provider: "google_search_console",
    displayName: "frakfinance.com (Search Console)",
    url: "https://www.frakfinance.com/",
    status: "pending_access",
    note: "Add the service account as a restricted user; externalId is the exact verified property URL.",
  },
  {
    brand: "frak-finance",
    channel: "linkedin",
    provider: "linkedin_marketing",
    displayName: "Frak Finance (LinkedIn company page)",
    handle: "frak-finance",
    url: "https://www.linkedin.com/company/frak-finance",
    status: "pending_access",
    note: "Company pages ARE covered by the LinkedIn Marketing API, but it needs app review.",
  },
  {
    brand: "frak-finance",
    channel: "x",
    provider: "x_api",
    displayName: "Frak Finance (X)",
    handle: "frakfinance",
    url: "https://x.com/frakfinance",
    status: "pending_access",
    note: "Owned-account metrics require a paid X API tier.",
  },
  {
    brand: "frak-finance",
    channel: "instagram",
    provider: "meta_graph",
    displayName: "Frak Finance (Instagram)",
    handle: "frakfinance",
    url: "https://www.instagram.com/frakfinance/",
    status: "pending_access",
    note: "Needs a Business account linked to a Facebook Page, plus Meta app review.",
  },
  {
    brand: "frak-finance",
    channel: "instagram",
    provider: "meta_graph",
    displayName: "Built to Exit Bootcamp (Instagram)",
    handle: "builttoexit_bootcamp",
    url: "https://www.instagram.com/builttoexit_bootcamp/",
    status: "pending_access",
    note: "Second Instagram presence for the bootcamp offer.",
  },
  {
    brand: "frak-finance",
    channel: "facebook",
    provider: "meta_graph",
    displayName: "Frak Finance (Facebook Page)",
    handle: "frakfinance",
    url: "https://www.facebook.com/frakfinance/",
    status: "pending_access",
  },
  {
    brand: "frak-finance",
    channel: "substack",
    provider: "substack",
    displayName: "Built to Exit (Substack)",
    handle: "builttoexit",
    url: "https://substack.com/@builttoexit",
    status: "manual_only",
    note: "Substack publishes no analytics API. Subscriber and open figures are exported by hand.",
  },
  {
    brand: "frak-finance",
    channel: "reddit",
    provider: "reddit_api",
    displayName: "Frak Finance (Reddit)",
    status: "not_established",
    note: "Account not created yet. Reddit does have a usable API once it exists.",
  },
  {
    brand: "frak-finance",
    channel: "quora",
    provider: "quora",
    displayName: "Frak Finance (Quora)",
    status: "not_established",
    note: "Account not created yet, and Quora exposes no analytics API for organic answers.",
  },

  /* --------------------------------------------------- Tom Dillon, personal -- */
  {
    brand: "tom-dillon",
    channel: "website",
    provider: "ga4",
    displayName: "tomdilloncfa.com (GA4)",
    url: "https://tomdilloncfa.com/",
    status: "pending_access",
  },
  {
    brand: "tom-dillon",
    channel: "website",
    provider: "google_search_console",
    displayName: "tomdilloncfa.com (Search Console)",
    url: "https://tomdilloncfa.com/",
    status: "pending_access",
  },
  {
    brand: "tom-dillon",
    channel: "linkedin",
    provider: "linkedin_marketing",
    displayName: "Tom Dillon (LinkedIn personal profile)",
    handle: "tom-dillon-cfa",
    url: "https://www.linkedin.com/in/tom-dillon-cfa",
    status: "manual_only",
    note: "LinkedIn exposes NO analytics API for personal profiles, at any tier. This is a platform limit, not a missing approval. Creator-mode exports or manual entry are the only routes.",
  },
  {
    brand: "tom-dillon",
    channel: "x",
    provider: "x_api",
    displayName: "Profit Hunter CFO (X)",
    handle: "profithuntercfo",
    url: "https://x.com/profithuntercfo",
    status: "pending_access",
  },
  {
    brand: "tom-dillon",
    channel: "youtube",
    provider: "youtube_data",
    displayName: "Profit Hunter CFO (YouTube)",
    handle: "profithuntercfo",
    url: "https://www.youtube.com/@profithuntercfo",
    status: "pending_access",
    note: "The channel sheet lists company YouTube as 'same as personal', so this one channel serves both brands.",
  },
  {
    brand: "tom-dillon",
    channel: "substack",
    provider: "substack",
    displayName: "Tom Dillon (Substack)",
    url: "https://tomdillon552230.substack.com/",
    status: "manual_only",
  },
];

async function seed() {
  console.log("Seeding metric catalog...");
  for (const m of METRIC_CATALOG) {
    await db
      .insert(metricDefinitions)
      .values({
        key: m.key,
        label: m.label,
        description: m.description,
        unit: m.unit,
        aggregation: m.aggregation,
        category: m.category,
        higherIsBetter: m.higherIsBetter,
      })
      .onConflictDoUpdate({
        target: metricDefinitions.key,
        set: {
          label: m.label,
          description: m.description,
          unit: m.unit,
          aggregation: m.aggregation,
          category: m.category,
          higherIsBetter: m.higherIsBetter,
        },
      });
  }
  console.log(`  ${METRIC_CATALOG.length} metrics`);

  console.log("Seeding client...");
  const [client] = await db
    .insert(clients)
    .values({
      slug: "frak-finance",
      name: "Frak Finance",
      timezone: "America/Chicago",
    })
    .onConflictDoUpdate({
      target: clients.slug,
      set: { name: "Frak Finance", updatedAt: new Date() },
    })
    .returning();

  console.log("Seeding brands...");
  const brandSeeds = [
    { slug: "frak-finance", name: "Frak Finance", kind: "company" as const },
    { slug: "tom-dillon", name: "Tom Dillon", kind: "person" as const },
  ];

  const brandIds = new Map<string, string>();
  for (const b of brandSeeds) {
    const [row] = await db
      .insert(brands)
      .values({ clientId: client.id, slug: b.slug, name: b.name, kind: b.kind })
      .onConflictDoUpdate({
        target: [brands.clientId, brands.slug],
        set: { name: b.name },
      })
      .returning();
    brandIds.set(b.slug, row.id);
  }

  console.log("Seeding channel accounts...");
  let inserted = 0;
  for (const a of ACCOUNTS) {
    const brandId = brandIds.get(a.brand);
    if (!brandId) throw new Error(`Unknown brand "${a.brand}" in ACCOUNTS.`);

    // No externalId yet for any of these, so the partial unique index on
    // (client, provider, externalId) cannot dedupe. Match on display name,
    // which is unique within this inventory.
    const existing = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.clientId, client.id),
          eq(channelAccounts.displayName, a.displayName),
        ),
      )
      .limit(1);

    const values = {
      clientId: client.id,
      brandId,
      channel: a.channel,
      provider: a.provider,
      displayName: a.displayName,
      handle: a.handle ?? null,
      url: a.url ?? null,
      status: a.status,
      config: a.note ? { note: a.note } : {},
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db.update(channelAccounts).set(values).where(eq(channelAccounts.id, existing[0].id));
    } else {
      await db.insert(channelAccounts).values(values);
      inserted++;
    }
  }

  const byStatus = ACCOUNTS.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`  ${ACCOUNTS.length} accounts (${inserted} new)`);
  console.log("  by status:", byStatus);
  console.log("\nSeed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
