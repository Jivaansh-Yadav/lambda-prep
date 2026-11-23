/**
 * Which Cloudflare Web Analytics (RUM) site tag the injected beacon reports
 * with, and whether a build renders the beacon at all.
 *
 * Kept out of `__root.tsx` so the rules can be tested without a DOM.
 *
 * The tag is a *public* identifier — Cloudflare ships it in the page HTML by
 * design — but it is a build-time decision, not a runtime one: a development
 * build renders nothing, so local sessions and forks never land in the real
 * deployment's numbers.
 *
 * There is a built-in default because the alternative failed in production:
 * requiring `VITE_CF_BEACON_TOKEN` meant that a deploy environment without
 * the variable silently shipped no beacon, and Cloudflare's numbers sat still
 * for two days while the app kept recording arrivals itself (the 97-vs-4
 * discrepancy in the admin panel). The variable still wins when it is set, and
 * `VITE_CF_BEACON_TOKEN=off` opts a build out entirely — which is what a fork
 * that wants to stay out of this dataset should do.
 */

/** Site tag of the production Web Analytics site. Public by nature: it is
 * rendered into the page HTML of every deployment that reports. Verified
 * live against Cloudflare's RUM dataset, which credits posts carrying it to
 * lambda-prep.pages.dev. */
export const PUBLIC_CF_BEACON_TOKEN = "a9d4d976f92b48ed89669f9959c889de";

/** Values that mean "render no beacon" rather than "use this tag". */
const OPT_OUT = new Set(["off", "none", "no", "false", "0"]);

/**
 * Resolves the site tag to inject, or null when this build should stay quiet.
 *
 * @param isDev    true for a development build (`import.meta.env.DEV`).
 * @param override the raw `VITE_CF_BEACON_TOKEN` value from the build env.
 */
export function resolveBeaconToken({
  isDev,
  override,
}: {
  isDev: boolean;
  override?: string | boolean | undefined;
}): string | null {
  if (isDev) return null;

  if (typeof override === "string") {
    const value = override.trim();
    if (value.length > 0) return OPT_OUT.has(value.toLowerCase()) ? null : value;
  }

  return PUBLIC_CF_BEACON_TOKEN;
}
