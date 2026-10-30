import { PanelLeft } from "lucide-react";
import { useState, type ReactNode } from "react";
import { REGULAR, WIDE, useMediaQuery } from "../lib/useMediaQuery";
import { IconButton } from "./Button";
import { cx } from "./cx";
import { TabBar, type TabItem } from "./TabBar";

export type NavItem = TabItem & { section?: string; inTabBar?: boolean; badge?: number };

/**
 * Seller app frame. Compact: floating tab bar. Regular: sidebar that slides over content.
 * Wide: sidebar pinned beside content, like a macOS/iPadOS split view.
 */
export function AppShell({ items, active, onNavigate, sidebarHeader, children }: {
  items: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  sidebarHeader?: ReactNode;
  children: (ctx: { sidebarToggle: ReactNode }) => ReactNode;
}) {
  const regular = useMediaQuery(REGULAR);
  const wide = useMediaQuery(WIDE);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pinned = wide;

  const sidebarToggle = regular && !pinned ? (
    <IconButton label="Tampilkan sidebar" onClick={() => setSidebarOpen(true)}>
      <PanelLeft className="size-5" />
    </IconButton>
  ) : null;

  const sections = new Map<string, NavItem[]>();
  for (const it of items) {
    const key = it.section ?? "";
    sections.set(key, [...(sections.get(key) ?? []), it]);
  }

  const sidebar = (
    <aside
      aria-label="Menu"
      className={cx(
        "vt-sidebar glass flex h-full w-[280px] flex-col overflow-y-auto rounded-[var(--radius-card)] p-3 squircle",
      )}
    >
      {sidebarHeader && <div className="mb-3 px-2 pt-1">{sidebarHeader}</div>}
      {[...sections.entries()].map(([section, list]) => (
        <div key={section} className="mb-4">
          {section && <div className="px-3 pb-1 text-footnote font-semibold text-label-2">{section}</div>}
          {list.map((it) => {
            const isActive = it.id === active;
            return (
              <button
                key={it.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  onNavigate(it.id);
                  setSidebarOpen(false);
                }}
                className={cx(
                  "flex min-h-[var(--tap)] w-full items-center gap-3 rounded-[12px] px-3 text-left text-body",
                  isActive ? "bg-fill-3 font-semibold text-tint-text" : "text-label hover:[@media(hover:hover)]:bg-fill-4",
                )}
              >
                <span aria-hidden className={cx("[&_svg]:size-[22px]", isActive ? "text-tint" : "text-tint")}>{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.badge ? <span className="rounded-full bg-fill-3 px-2 text-footnote font-semibold text-label-2 tabular">{it.badge}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );

  if (!regular) {
    const tabs = items.filter((i) => i.inTabBar);
    return (
      <div className="min-h-dvh pb-[calc(var(--safe-bottom)+96px)]">
        {children({ sidebarToggle: null })}
        <TabBar tabs={tabs} active={tabs.some((t) => t.id === active) ? active : "more"} onChange={onNavigate} />
      </div>
    );
  }

  return (
    <div className={cx("min-h-dvh", pinned && "grid grid-cols-[296px_minmax(0,1fr)]")}>
      {pinned ? (
        <div className="sticky top-0 h-dvh p-2 pr-0 pt-[max(8px,var(--safe-top))]">{sidebar}</div>
      ) : (
        <>
          <div
            aria-hidden
            onClick={() => setSidebarOpen(false)}
            className={cx("fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-300", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}
          />
          <div
            className={cx(
              "fixed inset-y-0 left-0 z-50 p-2 pt-[max(8px,var(--safe-top))] transition-transform duration-[var(--dur-spring)] [transition-timing-function:var(--ease-spring)]",
              sidebarOpen ? "translate-x-0" : "-translate-x-[110%]",
            )}
            inert={!sidebarOpen}
          >
            {sidebar}
          </div>
        </>
      )}
      <div className="min-w-0">{children({ sidebarToggle })}</div>
    </div>
  );
}

/** List + detail. Compact shows one at a time; regular and up shows both side by side. */
export function SplitView({ list, detail, showDetail }: { list: ReactNode; detail: ReactNode; showDetail: boolean }) {
  const regular = useMediaQuery(REGULAR);
  if (!regular) return <>{showDetail ? detail : list}</>;
  return (
    <div className="grid h-dvh grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <div className="min-w-0 overflow-y-auto overscroll-contain border-r-[0.5px] border-separator">{list}</div>
      <div className="min-w-0 overflow-y-auto overscroll-contain">{detail}</div>
    </div>
  );
}
