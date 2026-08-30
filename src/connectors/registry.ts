import type { Provider } from "@/db/schema";
import { METRIC_BY_KEY } from "@/metrics/catalog";
import type { Connector } from "./types";
import { ga4Connector } from "./ga4";
import { searchConsoleConnector } from "./search-console";

/**
 * Every wired connector. Adding a channel means adding one entry here.
 *
 * Providers absent from this map are not unsupported forever, they are simply
 * not built yet. `docs/channel-matrix.md` records what each remaining channel
 * needs before it can be added.
 */
const CONNECTORS: Connector[] = [ga4Connector, searchConsoleConnector];

/**
 * Fail at import time if a connector claims a metric that is not in the
 * catalog. A typo like "impresions" would otherwise fail much later, as a
 * foreign-key violation midway through a nightly sync.
 */
for (const connector of CONNECTORS) {
  for (const key of connector.emits) {
    if (!METRIC_BY_KEY.has(key)) {
      throw new Error(
        `Connector "${connector.provider}" declares unknown metric "${key}". ` +
          "Add it to METRIC_CATALOG or fix the name.",
      );
    }
  }
}

const BY_PROVIDER = new Map<Provider, Connector>(CONNECTORS.map((c) => [c.provider, c]));

export function getConnector(provider: Provider): Connector | undefined {
  return BY_PROVIDER.get(provider);
}

export function listConnectors(): Connector[] {
  return [...CONNECTORS];
}
