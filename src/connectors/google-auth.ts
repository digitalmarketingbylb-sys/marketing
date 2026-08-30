/**
 * Shared Google auth + HTTP for the GA4 and Search Console connectors.
 *
 * Both are called over REST rather than through `googleapis`. That package
 * pulls in every Google API surface for two endpoints; REST keeps the
 * dependency small and the request shapes visible at the call site, which
 * matters when debugging a 403 from a client's property.
 */
import { JWT } from "google-auth-library";
import type { Credentials } from "./types";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * Both auth styles resolve to a bearer token.
 *
 * Service account is the right default for an agency: the client adds one
 * service-account email as a read-only user on their GA4 property and Search
 * Console site, and no per-user OAuth token can expire or be revoked when
 * someone leaves. OAuth is supported for clients who will not add a service
 * account.
 */
export async function getAccessToken(
  credentials: Credentials,
  scopes: string[],
): Promise<string> {
  if (credentials.type === "service_account") {
    const jwt = new JWT({
      email: credentials.clientEmail,
      // Keys pasted through env vars arrive with literal \n sequences.
      key: credentials.privateKey.replace(/\\n/g, "\n"),
      scopes,
    });
    const { token } = await jwt.getAccessToken();
    if (!token) throw new Error("Google returned no access token for the service account.");
    return token;
  }

  if (credentials.type === "oauth2") {
    if (credentials.expiresAt && credentials.expiresAt < Date.now()) {
      throw new Error(
        "Google OAuth access token has expired and no refresh was performed. " +
          "Refresh the connection before syncing.",
      );
    }
    return credentials.accessToken;
  }

  throw new Error(`Credential type "${credentials.type}" is not valid for a Google API.`);
}

interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

/**
 * POST JSON with backoff on the failures Google actually returns under load:
 * 429 quota and 5xx. A 4xx other than 429 is a real error (bad property id,
 * missing permission) and must surface immediately rather than retry.
 */
export async function postJson<T>(
  url: string,
  token: string,
  body: unknown,
  { attempts = 4, baseDelayMs = 500 }: RetryOptions = {},
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return (await res.json()) as T;

    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    lastError = new Error(`Google API ${res.status}: ${text.slice(0, 500)}`);

    if (!retryable) throw lastError;

    if (attempt < attempts - 1) {
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError ?? new Error("Google API request failed.");
}

/** GA4 returns `date` dimension values as YYYYMMDD. */
export function ga4DateToIso(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Expected GA4 date as YYYYMMDD, got "${value}".`);
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
