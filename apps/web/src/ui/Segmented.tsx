import { useId } from "react";
import { cx } from "./cx";

export function Segmented<T extends string>({ options, value, onChange, label, className }: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const name = useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className={cx("relative grid h-9 rounded-full bg-fill-3 p-[3px]", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[3px] left-[3px] rounded-full bg-[var(--segment-thumb)] shadow-[0_3px_8px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)] transition-transform duration-[var(--dur-spring)] [transition-timing-function:var(--ease-spring)]"
        style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <label key={o.value} className="relative z-10 flex cursor-pointer items-center justify-center px-2 text-subhead font-medium">
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} className="peer sr-only" />
          <span className={cx("truncate transition-[font-weight]", o.value === value && "font-semibold")}>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
