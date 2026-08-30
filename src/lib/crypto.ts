/**
 * AES-256-GCM sealing for provider credentials.
 *
 * OAuth refresh tokens for a client's Google, LinkedIn and Meta accounts are
 * long-lived and high-value. They are encrypted at rest so that a database
 * dump is not also a credential dump.
 *
 * ENCRYPTION_KEY is 32 bytes, base64-encoded:  openssl rand -base64 32
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const KEY_BYTES = 32;

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${k.length}. ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return k;
}

/** Returns `iv.ciphertext.authTag`, each base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, ct, cipher.getAuthTag()].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 3) throw new Error("Malformed sealed value.");
  const [iv, ct, tag] = parts.map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  // Throws if the ciphertext or tag was tampered with, which is the point.
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function sealJson(value: unknown): string {
  return seal(JSON.stringify(value));
}

export function openJson<T>(sealed: string): T {
  return JSON.parse(open(sealed)) as T;
}
