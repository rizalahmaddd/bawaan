/** Apex the stores live under; self-hosters set VITE_ROOT_DOMAIN at build time to match ROOT_DOMAIN in wrangler.jsonc. */
export const ROOT_DOMAIN: string = import.meta.env.VITE_ROOT_DOMAIN || "bawaan.my.id";
const ROOT = ROOT_DOMAIN;

export const storeHost = (slug: string) => `${slug}.${ROOT_DOMAIN}`;

/**
 * Link to another surface. On the real domain that's a subdomain; on preview/dev hosts it's the
 * same origin with ?host=, which the Worker turns into a cookie.
 */
export function surfaceUrl(target: "landing" | "app" | (string & {}), path = "/"): string {
  const { hostname, protocol } = location;
  if (hostname === ROOT || hostname.endsWith("." + ROOT)) {
    const host = target === "landing" ? ROOT : `${target}.${ROOT}`;
    return `${protocol}//${host}${path}`;
  }
  return `${path}?host=${encodeURIComponent(target)}`;
}

/** Customer-typed links are shown to sellers, so anything but http(s) stays plain text. */
export const safeHref = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : undefined);
