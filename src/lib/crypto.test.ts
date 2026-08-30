import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

describe("credential sealing", () => {
  let seal: typeof import("./crypto").seal;
  let open: typeof import("./crypto").open;
  let sealJson: typeof import("./crypto").sealJson;
  let openJson: typeof import("./crypto").openJson;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    ({ seal, open, sealJson, openJson } = await import("./crypto"));
  });

  it("round-trips a value", () => {
    expect(open(seal("refresh-token-abc"))).toBe("refresh-token-abc");
  });

  it("round-trips JSON credentials", () => {
    const creds = { type: "oauth2", accessToken: "a", refreshToken: "b" };
    expect(openJson(sealJson(creds))).toEqual(creds);
  });

  it("produces different ciphertext each time", () => {
    // A fresh IV per seal; identical output would leak that two clients share
    // a credential.
    expect(seal("same")).not.toBe(seal("same"));
  });

  it("rejects a tampered ciphertext instead of returning garbage", () => {
    const sealed = seal("secret");
    const [iv, ct, tag] = sealed.split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => open([iv, flipped.toString("base64url"), tag].join("."))).toThrow();
  });

  it("rejects a malformed value", () => {
    expect(() => open("not-sealed")).toThrow(/Malformed/);
  });
});
