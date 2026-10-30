import { isSlugShape } from "./slug-shape";

export type Surface =
  | { kind: "landing" }
  | { kind: "app" }
  | { kind: "accounts" }
  | { kind: "cdn" }
  | { kind: "store"; slug: string }
  | { kind: "redirect"; to: string }
  | { kind: "not-found"; reason: "unknown-host" | "invalid-slug" | "nested" };

const FIXED: Record<string, Surface["kind"]> = {
  app: "app",
  accounts: "accounts",
  cdn: "cdn",
};

/**
 * Maps a request hostname to the surface that should serve it.
 * `rootDomains` lists every apex we answer for, e.g. ["bawaan.my.id", "localhost"].
 */
export function resolveSurface(hostname: string, rootDomains: readonly string[]): Surface {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const root = rootDomains.find((d) => host === d || host.endsWith("." + d));
  if (!root) return { kind: "not-found", reason: "unknown-host" };
  if (host === root) return { kind: "landing" };

  const sub = host.slice(0, -(root.length + 1));
  if (sub.includes(".")) return { kind: "not-found", reason: "nested" };
  if (sub === "www") return { kind: "redirect", to: root };

  const fixed = FIXED[sub];
  if (fixed) return { kind: fixed } as Surface;

  return isSlugShape(sub) ? { kind: "store", slug: sub } : { kind: "not-found", reason: "invalid-slug" };
}

/** Preview/dev override: "app", "landing" or a store slug passed as ?host= */
export function overrideHostname(override: string, root: string): string {
  if (override === "landing" || override === "") return root;
  return `${override}.${root}`;
}
