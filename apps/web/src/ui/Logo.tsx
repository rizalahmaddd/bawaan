import { cx } from "./cx";

/** Tote bag with a check: what you carry home, and the "Dapat" moment customers wait for. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cx("shrink-0", className)} role="img" aria-label="Bawaan">
      <defs>
        <linearGradient id="bw-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d9bff" />
          <stop offset="1" stopColor="#0066e0" />
        </linearGradient>
      </defs>
      <path d="M32 0c19.8 0 32 4.2 32 32S51.8 64 32 64 0 59.8 0 32 12.2 0 32 0Z" fill="url(#bw-g)" />
      <path d="M24 23v-2.5a8 8 0 0 1 16 0V23" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M17.6 23h28.8a2 2 0 0 1 2 1.86l1.5 21.3A4 4 0 0 1 45.9 50.5H18.1a4 4 0 0 1-4-4.34l1.5-21.3a2 2 0 0 1 2-1.86Z" fill="#fff" />
      <path d="m25.5 36.8 4.6 4.6 8.6-9.4" fill="none" stroke="#0a7cff" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-8" />
      <span className="font-[family-name:var(--font-rounded)] text-[1.35rem] font-bold tracking-[-0.03em]">bawaan</span>
    </span>
  );
}
