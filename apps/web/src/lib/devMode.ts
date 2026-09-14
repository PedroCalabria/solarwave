import "server-only";

/**
 * Whether the portal shows the development-only controls.
 *
 * Defaults to OFF, and the default is the point: these controls are useful
 * while building and are noise — or worse, a wrong impression — in front of
 * anyone being shown the product. A demo should look like the product.
 *
 * Read per request rather than captured at module load, because the page that
 * asks is `force-dynamic` and a value frozen at build time would survive a
 * change to the environment.
 *
 * Accepts `true` or `1`; anything else, unset included, is off.
 */
export function isDevMode(): boolean {
  const raw = process.env.DEV_MODE?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}
