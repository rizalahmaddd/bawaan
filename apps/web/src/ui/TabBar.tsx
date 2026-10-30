import type { ReactNode } from "react";
import { useScrolledDown } from "../lib/useScrollDirection";
import { cx } from "./cx";

export type TabItem = { id: string; label: string; icon: ReactNode };

/**
 * Floating glass tab bar (iOS 26+). It minimises to the active tab while scrolling down,
 * and an optional accessory (search, compose) sits in its own circle beside it.
 */
export function TabBar({ tabs, active, onChange, accessory, className }: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  accessory?: ReactNode;
  className?: string;
}) {
  const minimized = useScrolledDown();
  return (
    <nav
      aria-label="Navigasi utama"
      className={cx(
        "vt-tabbar fixed inset-x-0 bottom-0 z-40 flex items-end gap-3 px-[max(var(--gutter),var(--safe-left))]",
        "pb-[max(var(--safe-bottom),12px)] pointer-events-none",
        className,
      )}
    >
      <div
        className={cx(
          "glass pointer-events-auto flex h-[62px] items-stretch rounded-full p-1 transition-[max-width] duration-[var(--dur-spring)] [transition-timing-function:var(--ease-spring)]",
          minimized ? "max-w-[62px]" : "max-w-full flex-1",
        )}
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          const hidden = minimized && !isActive;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={t.label}
              tabIndex={hidden ? -1 : 0}
              className={cx(
                "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full transition-[flex,opacity,background-color] duration-300",
                hidden ? "pointer-events-none flex-[0_0_0px] opacity-0" : "flex-1",
                isActive ? "bg-fill-3 text-tint" : "text-label",
                minimized && isActive && "aspect-square",
              )}
            >
              <span aria-hidden className="[&_svg]:size-6">{t.icon}</span>
              {!minimized && <span className="max-w-full truncate px-1 text-[10px] font-semibold leading-tight">{t.label}</span>}
            </button>
          );
        })}
      </div>
      {minimized && <div className="flex-1" />}
      {accessory && <div className="pointer-events-auto">{accessory}</div>}
    </nav>
  );
}
