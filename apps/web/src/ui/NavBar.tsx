import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

const BAR_HEIGHT = 52;

export type NavBarProps = {
  title: string;
  largeTitle?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Rendered under the large title, e.g. a search field or segmented control. */
  accessory?: ReactNode;
  className?: string;
};

/**
 * iOS navigation bar: a large title that hands over to the inline title once it scrolls under the bar,
 * and a soft blurred edge that only appears after content starts moving underneath.
 */
export function NavBar({ title, largeTitle = true, leading, trailing, accessory, className }: NavBarProps) {
  const topRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(!largeTitle);

  useEffect(() => {
    const margin = `-${BAR_HEIGHT}px 0px 0px 0px`;
    const observers: IntersectionObserver[] = [];
    if (topRef.current) {
      const o = new IntersectionObserver(([e]) => setScrolled(!e!.isIntersecting), { rootMargin: margin });
      o.observe(topRef.current);
      observers.push(o);
    }
    if (largeTitle && titleRef.current) {
      const o = new IntersectionObserver(([e]) => setCollapsed(!e!.isIntersecting), { rootMargin: margin, threshold: 0.4 });
      o.observe(titleRef.current);
      observers.push(o);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, [largeTitle]);

  return (
    <>
      <div ref={topRef} aria-hidden className="h-px" />
      <header className={cx("sticky top-0 z-30 -mt-px pt-[var(--safe-top)]", className)}>
        <div
          aria-hidden
          className={cx(
            "scroll-edge-top pointer-events-none absolute inset-x-0 top-0 -bottom-5 transition-opacity duration-300",
            "bg-[color-mix(in_srgb,var(--bg-grouped)_72%,transparent)] [backdrop-filter:blur(14px)] [-webkit-backdrop-filter:blur(14px)]",
            scrolled ? "opacity-100" : "opacity-0",
          )}
        />
        <div className="relative flex items-center gap-2 px-[max(var(--gutter),var(--safe-left))]" style={{ height: BAR_HEIGHT }}>
          <div className="flex flex-1 basis-0 items-center gap-2">{leading}</div>
          <div
            className={cx(
              "pointer-events-none min-w-0 truncate text-center text-headline transition-[opacity,transform] duration-200",
              collapsed ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
            )}
            aria-hidden={!collapsed}
          >
            {title}
          </div>
          <div className="flex flex-1 basis-0 items-center justify-end gap-2">{trailing}</div>
        </div>
      </header>
      {largeTitle && (
        <div className="px-[max(var(--gutter),var(--safe-left))] pb-2">
          <h1 ref={titleRef} className="text-large-title">
            {title}
          </h1>
        </div>
      )}
      {!largeTitle && <h1 className="sr-only">{title}</h1>}
      {accessory && <div className="px-[max(var(--gutter),var(--safe-left))] pb-3">{accessory}</div>}
    </>
  );
}

/** Long labels would run into the centered title, so like iOS they fall back to a plain "Kembali". */
export function NavBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  const text = label.length > 16 ? "Kembali" : label;
  return (
    <button type="button" onClick={onClick} className="glass -ml-1 inline-flex h-11 min-w-0 max-w-[40vw] items-center gap-0.5 rounded-full pl-2 pr-4 text-body text-tint-text" aria-label={`Kembali ke ${label}`}>
      <ChevronLeft className="size-6 shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </button>
  );
}
