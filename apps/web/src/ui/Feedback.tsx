import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { cx } from "./cx";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("spinner size-5 text-label-2", className)} aria-label="Memuat" />;
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[40dvh] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-elevated" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="skeleton size-10 rounded-[10px]" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/2 rounded" />
            <div className="skeleton h-3 w-1/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col items-center rounded-[var(--radius-card)] bg-elevated px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-fill-3 text-tint [&_svg]:size-7">{icon}</div>
      <h2 className="text-title3">{title}</h2>
      {body && <p className="mt-2 max-w-[24rem] text-subhead text-label-2">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-[var(--radius-card)] bg-elevated px-6 py-10 text-center">
      <AlertCircle className="mb-3 size-8 text-red" />
      <p className="text-body">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 text-body font-semibold text-tint-text">
          Coba lagi
        </button>
      )}
    </div>
  );
}

type Hud = { id: number; kind: "ok" | "error"; text: string };
const HudContext = createContext<(text: string, kind?: Hud["kind"]) => void>(() => {});

/** iOS-style banner from the top for short confirmations and errors. */
export function HudProvider({ children }: { children: ReactNode }) {
  const [hud, setHud] = useState<Hud | null>(null);
  const show = useCallback((text: string, kind: Hud["kind"] = "ok") => setHud({ id: Date.now(), kind, text }), []);
  useEffect(() => {
    if (!hud) return;
    const t = setTimeout(() => setHud(null), hud.kind === "error" ? 4500 : 2200);
    return () => clearTimeout(t);
  }, [hud]);
  return (
    <HudContext.Provider value={show}>
      {children}
      <ConfirmHost />
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[60]">
        {hud && (
          <div
            key={hud.id}
            role={hud.kind === "error" ? "alert" : "status"}
            className="hud glass absolute left-1/2 top-[calc(var(--safe-top)+10px)] flex max-w-[min(420px,calc(100%-32px))] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-subhead font-semibold"
          >
            {hud.kind === "ok" ? <CheckCircle2 className="size-5 shrink-0 text-green" /> : <AlertCircle className="size-5 shrink-0 text-red" />}
            <span>{hud.text}</span>
          </div>
        )}
      </div>
    </HudContext.Provider>
  );
}

export const useHud = () => useContext(HudContext);

type Ask = { message: string; action: string; destructive: boolean; resolve: (ok: boolean) => void };
let openAsk: ((a: Ask) => void) | null = null;

/** iOS-style alert in place of window.confirm; resolves true when the action is tapped. */
export function ask(message: string, opts: { action?: string; destructive?: boolean } = {}): Promise<boolean> {
  if (!openAsk) return Promise.resolve(window.confirm(message));
  const show = openAsk;
  return new Promise((resolve) => show({ message, action: opts.action ?? "Lanjut", destructive: !!opts.destructive, resolve }));
}

function ConfirmHost() {
  const [pending, setPending] = useState<Ask | null>(null);
  useEffect(() => {
    openAsk = setPending;
    return () => {
      openAsk = null;
    };
  }, []);
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <AlertDialog.Root open={!!pending} onOpenChange={(o) => !o && close(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="sheet-overlay fixed inset-0 z-[70] bg-[var(--scrim)]" />
        <AlertDialog.Content className="sheet-panel fixed left-1/2 top-1/2 z-[70] w-[min(300px,calc(100%-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[14px] bg-elevated text-center shadow-2xl outline-none">
          <AlertDialog.Title className="px-4 pb-4 pt-5 text-subhead font-semibold">{pending?.message}</AlertDialog.Title>
          <AlertDialog.Description className="sr-only">Konfirmasi</AlertDialog.Description>
          <div className="grid grid-cols-2 border-t-[0.5px] border-separator text-body">
            <AlertDialog.Cancel className="border-r-[0.5px] border-separator py-3 text-tint-text">Batal</AlertDialog.Cancel>
            <AlertDialog.Action onClick={() => close(true)} className={cx("py-3 font-semibold", pending?.destructive ? "text-red-text" : "text-tint-text")}>
              {pending?.action}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
