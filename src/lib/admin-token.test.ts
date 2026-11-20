import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "./admin-token";

const SECRET = "correct horse battery staple";
const NOW = 1_700_000_000_000; // fixed clock, so TTL assertions are exact

describe("admin session tokens", () => {
  it("accepts a token it just issued", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    expect(await verifyAdminSessionToken(token, SECRET, NOW)).toBe(true);
  });

  it("carries the expiry instead of storing server state", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    const [, expiresRaw] = token.split(".");
    expect(Number(expiresRaw)).toBe(Math.floor(NOW / 1000) + ADMIN_SESSION_TTL_SECONDS);
  });

  it("stays valid right up to the expiry and dies after it", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    const expiresAtMs = NOW + ADMIN_SESSION_TTL_SECONDS * 1000;
    expect(await verifyAdminSessionToken(token, SECRET, expiresAtMs - 1000)).toBe(true);
    expect(await verifyAdminSessionToken(token, SECRET, expiresAtMs)).toBe(false);
    expect(await verifyAdminSessionToken(token, SECRET, expiresAtMs + 60_000)).toBe(false);
  });

  it("refuses a token signed with a different secret", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    expect(await verifyAdminSessionToken(token, `${SECRET} `, NOW)).toBe(false);
  });

  it("refuses a tampered expiry, because the signature covers it", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    const [version, expiresRaw, signature] = token.split(".");
    const extended = `${version}.${Number(expiresRaw) + 60}.${signature}`;
    expect(await verifyAdminSessionToken(extended, SECRET, NOW)).toBe(false);
  });

  it("refuses a tampered signature", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    const [version, expiresRaw, signature] = token.split(".");
    const flipped = signature!.slice(0, -1) + (signature!.endsWith("A") ? "B" : "A");
    expect(await verifyAdminSessionToken(`${version}.${expiresRaw}.${flipped}`, SECRET, NOW)).toBe(false);
  });

  it("refuses malformed or missing cookies instead of throwing", async () => {
    for (const bad of [undefined, "", "v1", "v1.1700000000", "v1.notanumber.abc", "v2.1700000000.abc", "a.b.c.d"]) {
      expect(await verifyAdminSessionToken(bad, SECRET, NOW)).toBe(false);
    }
  });

  it("refuses an expiry further out than the TTL allows", async () => {
    // Guards against honouring a token from a different clock (or a
    // signature replay after the TTL was shortened).
    const generous = await createAdminSessionToken(SECRET, NOW + 60 * 60 * 1000);
    expect(await verifyAdminSessionToken(generous, SECRET, NOW)).toBe(false);
  });
});
