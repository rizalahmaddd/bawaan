import { ClipboardList, CornerDownLeft, Search, UserRound } from "lucide-react";
import { Dialog } from "radix-ui";
import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { navigate } from "../lib/router";
import { cx } from "../ui/cx";
import { useTenant } from "./context";
import { useTenantQuery } from "./hooks";
import { navFor } from "./nav";

type Command = { id: string; label: string; hint?: string; icon: ReactNode; run: () => void };

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/**
 * Desktop keyboard layer: ⌘K palette, "/" to search, ⌘↩ to submit the open form,
 * and g + letter to jump between screens.
 */
export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const t = useTenant();
  useEffect(() => {
    let leader = 0;
    const jumps: Record<string, string> = { h: "/", p: "/pesanan", b: "/belanja", c: "/pelanggan", t: "/trip", y: "/pembayaran", k: "/pengiriman", l: "/laporan", s: "/pengaturan" };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const form = (document.activeElement as HTMLElement | null)?.closest("form");
        if (form) {
          e.preventDefault();
          form.requestSubmit();
        }
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        const field = document.querySelector<HTMLInputElement>('main input[type="search"], input[type="search"]');
        if (field) {
          e.preventDefault();
          field.focus();
        }
        return;
      }
      if (e.key === "g") {
        leader = Date.now();
        return;
      }
      if (Date.now() - leader < 1200 && jumps[e.key]) {
        leader = 0;
        navigate(jumps[e.key]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t.id]);
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}

type OrderHit = { id: string; code: string; customer: string; tripTitle: string };
type CustomerHit = { id: string; name: string; phone: string };

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTenant();
  const [term, setTerm] = useState("");
  const [cursor, setCursor] = useState(0);
  const q = useDeferredValue(term.trim());
  const searching = open && q.length >= 2;
  const orders = useTenantQuery<OrderHit[]>(["palette", "orders", q], `/orders?status=&q=${encodeURIComponent(q)}`, searching);
  const customers = useTenantQuery<CustomerHit[]>(["palette", "customers", q], `/customers?q=${encodeURIComponent(q)}`, searching);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => (onOpenChange(false), navigate(path));
    const lower = q.toLowerCase();
    const screens = navFor(t)
      .filter((n) => n.section !== "__tab-only")
      .filter((n) => !lower || n.label.toLowerCase().includes(lower))
      .map((n) => ({ id: `nav:${n.id}`, label: n.label, hint: "Buka", icon: n.icon, run: go(n.path) }));
    const hits = searching
      ? [
          ...(orders.data ?? []).slice(0, 6).map((o) => ({ id: `o:${o.id}`, label: `${o.code} · ${o.customer}`, hint: o.tripTitle, icon: <ClipboardList />, run: go(`/pesanan/${o.id}`) })),
          ...(customers.data ?? []).slice(0, 6).map((c) => ({ id: `c:${c.id}`, label: c.name, hint: c.phone, icon: <UserRound />, run: go(`/pelanggan/${c.id}`) })),
        ]
      : [];
    return [...hits, ...screens];
  }, [q, searching, orders.data, customers.data, t, onOpenChange]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(commands.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commands[cursor]?.run();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="glass fixed left-1/2 top-[12vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[22px]"
        >
          <Dialog.Title className="sr-only">Perintah cepat</Dialog.Title>
          <label className="flex h-14 items-center gap-3 border-b-[0.5px] border-separator px-4">
            <Search className="size-5 text-label-2" aria-hidden />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Cari pesanan, pelanggan, atau layar"
              aria-label="Cari"
              className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-2"
            />
            <kbd className="rounded-md bg-fill-3 px-1.5 py-0.5 text-caption1 text-label-2">esc</kbd>
          </label>
          <ul role="listbox" aria-label="Hasil" className="max-h-[50vh] overflow-y-auto p-1.5">
            {commands.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onMouseMove={() => setCursor(i)}
                  onClick={c.run}
                  className={cx("flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left", i === cursor && "bg-fill-3")}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-tint text-white [&_svg]:size-4">{c.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-body">{c.label}</span>
                  {c.hint && <span className="shrink-0 truncate text-footnote text-label-2">{c.hint}</span>}
                  {i === cursor && <CornerDownLeft className="size-4 shrink-0 text-label-2" />}
                </button>
              </li>
            ))}
            {!commands.length && <li className="px-3 py-6 text-center text-subhead text-label-2">Tidak ada hasil</li>}
          </ul>
          <p className="border-t-[0.5px] border-separator px-4 py-2 text-caption1 text-label-2">
            ↑↓ pilih · ↩ buka · / cari · g lalu p/b/c/t/y/k/l untuk pindah layar · J/K di daftar pesanan · ⌘↩ simpan
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
