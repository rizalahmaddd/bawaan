import type { ReactNode } from "react";
import { cx } from "./cx";

export type Tone = "green" | "orange" | "red" | "blue" | "indigo" | "gray";

const tones: Record<Tone, string> = {
  green: "text-green-text bg-[color-mix(in_srgb,var(--green)_16%,transparent)]",
  orange: "text-orange-text bg-[color-mix(in_srgb,var(--orange)_16%,transparent)]",
  red: "text-red-text bg-[color-mix(in_srgb,var(--red)_14%,transparent)]",
  blue: "text-tint-text bg-[color-mix(in_srgb,var(--tint)_14%,transparent)]",
  indigo: "text-[var(--indigo-text)] bg-[color-mix(in_srgb,var(--indigo)_14%,transparent)]",
  gray: "text-[var(--gray-text)] bg-fill-3",
};

/** Status label: always icon + text, never color alone. */
export function Pill({ tone, icon, children, className }: { tone: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-footnote font-semibold whitespace-nowrap [&_svg]:size-3.5", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
