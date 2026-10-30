import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export function ListSection({ header, footer, children, className }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-8", className)}>
      {header && <h3 className="mb-1.5 px-4 text-footnote font-normal uppercase tracking-wide text-label-2">{header}</h3>}
      <div className="squircle overflow-hidden rounded-[var(--radius-card)] bg-elevated">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-footnote text-label-2">{footer}</p>}
    </section>
  );
}

export type ListRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  iconBg?: string;
  chevron?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  destructive?: boolean;
  selected?: boolean;
};

export function ListRow({ title, subtitle, value, icon, iconBg, chevron, trailing, onClick, href, destructive, selected }: ListRowProps) {
  const body = (
    <>
      {icon && (
        <span
          className="squircle flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white [&_svg]:size-[18px]"
          style={{ background: iconBg ?? "var(--tint)" }}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <span className="relative flex min-h-[var(--tap)] min-w-0 flex-1 items-center gap-2 py-2.5 pr-4 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-bottom after:scale-y-50 after:bg-separator group-last/row:after:hidden">
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-body", destructive && "text-red-text")}>{title}</span>
          {subtitle && <span className="block truncate text-subhead text-label-2">{subtitle}</span>}
        </span>
        {value !== undefined && <span className="shrink-0 text-body text-label-2 tabular">{value}</span>}
        {trailing}
        {chevron && <ChevronRight className="size-[18px] shrink-0 text-label-3" strokeWidth={2.5} aria-hidden />}
      </span>
    </>
  );
  const cls = "group/row flex w-full items-center gap-3 pl-4 text-left";
  const interactive = "transition-colors active:bg-fill-4 hover:[@media(hover:hover)]:bg-fill-4";
  if (href) return <a href={href} className={cx(cls, interactive)}>{body}</a>;
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-current={selected || undefined} className={cx(cls, interactive, selected && "bg-fill-3")}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}
