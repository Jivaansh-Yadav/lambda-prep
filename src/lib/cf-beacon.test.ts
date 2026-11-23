import { describe, expect, it } from "vitest";

import { PUBLIC_CF_BEACON_TOKEN, resolveBeaconToken } from "./cf-beacon";

describe("resolveBeaconToken", () => {
  it("renders no beacon in a development build", () => {
    expect(resolveBeaconToken({ isDev: true })).toBeNull();
    expect(resolveBeaconToken({ isDev: true, override: "abc123" })).toBeNull();
  });

  it("falls back to the production tag when the build env has no override", () => {
    // The regression this guards: a deploy environment without
    // VITE_CF_BEACON_TOKEN used to ship no beacon at all, and Cloudflare's
    // numbers stood still while the app kept recording arrivals.
    expect(resolveBeaconToken({ isDev: false })).toBe(PUBLIC_CF_BEACON_TOKEN);
    expect(resolveBeaconToken({ isDev: false, override: "" })).toBe(PUBLIC_CF_BEACON_TOKEN);
    expect(resolveBeaconToken({ isDev: false, override: "   " })).toBe(PUBLIC_CF_BEACON_TOKEN);
    expect(resolveBeaconToken({ isDev: false, override: undefined })).toBe(PUBLIC_CF_BEACON_TOKEN);
  });

  it("lets the build env override the tag", () => {
    expect(resolveBeaconToken({ isDev: false, override: "fork-tag" })).toBe("fork-tag");
    expect(resolveBeaconToken({ isDev: false, override: " fork-tag " })).toBe("fork-tag");
  });

  it("opts out when the build env says off", () => {
    for (const value of ["off", "OFF", "none", "false", "0"]) {
      expect(resolveBeaconToken({ isDev: false, override: value })).toBeNull();
    }
  });

  it("ignores a boolean override, which Vite can produce for flags", () => {
    expect(resolveBeaconToken({ isDev: false, override: true })).toBe(PUBLIC_CF_BEACON_TOKEN);
    expect(resolveBeaconToken({ isDev: false, override: false })).toBe(PUBLIC_CF_BEACON_TOKEN);
  });
});
