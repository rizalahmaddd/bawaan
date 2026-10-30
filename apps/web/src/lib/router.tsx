import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") window.addEventListener("popstate", emit);

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const snapshot = () => location.pathname + location.search;

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot, () => "/");
  const url = new URL(href, "http://x");
  return { pathname: url.pathname, search: url.searchParams };
}

type Direction = "forward" | "back" | "none";

/** Same-document View Transitions give the iOS push/pop feel where supported, and a plain swap elsewhere. */
export function navigate(to: string, opts: { replace?: boolean; direction?: Direction } = {}) {
  if (to === snapshot()) return;
  const apply = () => {
    if (opts.replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    emit();
    window.scrollTo(0, 0);
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { types?: Set<string> } };
  if (opts.direction !== "none" && doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.dataset.nav = opts.direction ?? "forward";
    doc.startViewTransition(apply);
  } else apply();
}

export function back(fallback: string) {
  if (history.length > 1 && document.referrer.startsWith(location.origin)) {
    document.documentElement.dataset.nav = "back";
    history.back();
  } else navigate(fallback, { direction: "back", replace: true });
}

export function Link({ to, direction, replace, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; direction?: Direction; replace?: boolean }) {
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to, { direction, replace });
      }}
      {...rest}
    />
  );
}

/** Matches "/pesanan/:id" style patterns; returns params or null. */
export function match(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = pathname.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(s[i]!);
    else if (seg !== s[i]) return null;
  }
  return params;
}
