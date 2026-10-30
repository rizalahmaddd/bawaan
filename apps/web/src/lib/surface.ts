import { resolveSurface, type Surface } from "@bawaan/shared/host";
import { ROOT_DOMAIN } from "./links";

/** The Worker stamps the surface on <html>; fall back to the hostname when it didn't (e.g. plain Vite). */
export function currentSurface(): Surface {
  const el = document.documentElement;
  const kind = el.dataset.surface as Surface["kind"] | undefined;
  if (kind === "store") return { kind, slug: el.dataset.slug ?? "" };
  if (kind === "not-found") return { kind, reason: "unknown-host" };
  if (kind === "landing" || kind === "app" || kind === "accounts" || kind === "cdn") return { kind };
  return resolveSurface(location.hostname, [ROOT_DOMAIN, "localhost"]);
}
