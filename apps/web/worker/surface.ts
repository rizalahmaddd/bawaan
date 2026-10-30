import { overrideHostname, resolveSurface, type Surface } from "@bawaan/shared";

export const HOST_OVERRIDE_COOKIE = "bawaan_host";

/**
 * Production answers only for real hostnames. Outside production (workers.dev preview, local dev,
 * e2e) a `?host=app|landing|<slug>` query or cookie picks the surface, because those hosts
 * can't carry our subdomains.
 */
export function surfaceFor(req: Request, env: Env): { surface: Surface; setOverride?: string } {
  const url = new URL(req.url);
  const roots = [env.ROOT_DOMAIN, "localhost"];

  if (env.ENVIRONMENT !== "production") {
    const fromQuery = url.searchParams.get("host");
    const fromCookie = readCookie(req, HOST_OVERRIDE_COOKIE);
    const override = fromQuery ?? fromCookie;
    if (override !== null) {
      const surface = resolveSurface(overrideHostname(override, env.ROOT_DOMAIN), roots);
      return fromQuery === null ? { surface } : { surface, setOverride: fromQuery };
    }
    if (!roots.some((r) => url.hostname === r || url.hostname.endsWith("." + r))) {
      return { surface: { kind: "landing" } };
    }
  }

  return { surface: resolveSurface(url.hostname, roots) };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
