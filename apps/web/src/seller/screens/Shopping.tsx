import { formatForeign } from "@bawaan/shared";
import { CheckCircle2, CloudUpload, ShoppingBag, WifiOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ApiError, errorMessage } from "../../lib/api";
import { safeHref } from "../../lib/links";
import { navigate } from "../../lib/router";
import { media } from "../../lib/types";
import { Button } from "../../ui/Button";
import { discard, enqueue, flush, useOutbox, type OutboxEntry } from "../../lib/outbox";
import { useOnline } from "../../lib/useOnline";
import { EmptyState, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Pill } from "../../ui/Pill";
import { SearchField } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { ItemPill } from "../common";
import { useTenant } from "../context";
import { DecideSheet, type DecideTarget } from "../DecideSheet";
import { isTyping } from "../CommandPalette";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type ShoppingItem = DecideTarget & {
  link: string | null;
  note: string | null;
  productId: string | null;
  status: "hunting" | "needs_approval";
  orderCode: string;
  orderId: string;
  customer: string;
  tripId: string;
  tripTitle: string;
};

const cacheKey = (tenantId: string) => `bawaan.shopping.${tenantId}`;

/** Last list seen online, so the checklist still opens in a shop basement with no signal. */
function useCachedShopping(tenantId: string, fresh: ShoppingItem[] | undefined) {
  const [cached] = useState<ShoppingItem[] | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(cacheKey(tenantId)) ?? "null");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!fresh) return;
    try {
      localStorage.setItem(cacheKey(tenantId), JSON.stringify(fresh));
    } catch {}
  }, [fresh, tenantId]);
  return fresh ?? cached ?? undefined;
}

function SyncBanner({ pending, offline }: { pending: OutboxEntry[]; offline: boolean }) {
  const hud = useHud();
  const qc = useQueryClient();
  const t = useTenant();
  const [busy, setBusy] = useState(false);
  const failed = pending.filter((e) => e.error);
  if (!pending.length && !offline) return null;
  return (
    <ListSection
      footer={failed.length ? "Keputusan yang ditolak server tidak dikirim ulang. Buka barangnya lagi untuk memutuskan ulang." : offline ? "Kamu sedang offline. Keputusan disimpan di HP ini." : undefined}
    >
      <div className="flex items-center gap-3 p-4">
        {offline ? <WifiOff className="size-6 shrink-0 text-orange" /> : <CloudUpload className="size-6 shrink-0 text-tint" />}
        <div className="min-w-0 flex-1">
          <p className="text-headline">{pending.length ? `${pending.length - failed.length} keputusan menunggu dikirim` : "Offline"}</p>
          {failed.length > 0 && <p className="text-subhead text-red-text">{failed.length} gagal</p>}
        </div>
        {pending.length - failed.length > 0 && !offline && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await flush();
              setBusy(false);
              if (r.sent) {
                hud(`${r.sent} keputusan terkirim`);
                qc.invalidateQueries({ queryKey: [t.id] });
              }
            }}
          >
            Kirim
          </Button>
        )}
      </div>
      {failed.map((e) => (
        <ListRow key={e.id} title={e.title} subtitle={e.error} trailing={<Button size="sm" variant="gray" onClick={() => discard(e.id)}>Hapus</Button>} />
      ))}
    </ListSection>
  );
}

export function Shopping() {
  const t = useTenant();
  const q = useTenantQuery<ShoppingItem[]>(["shopping"], "/shopping");
  const online = useOnline();
  const pending = useOutbox(t.base);
  const queued = useMemo(() => new Set(pending.filter((e) => !e.error).map((e) => e.itemId)), [pending]);
  const data = useCachedShopping(t.id, q.data);
  const [term, setTerm] = useState("");
  const dterm = useDeferredValue(term.trim().toLowerCase());
  const [picked, setPicked] = useState<DecideTarget | null>(null);

  // Same product across customers sits together so one shelf visit covers every order.
  const groups = useMemo(() => {
    const rows = (data ?? []).filter((i) => !dterm || `${i.title} ${i.variant ?? ""} ${i.customer} ${i.orderCode}`.toLowerCase().includes(dterm));
    const byTrip = new Map<string, { title: string; products: Map<string, ShoppingItem[]> }>();
    for (const r of rows) {
      const trip = byTrip.get(r.tripId) ?? { title: r.tripTitle, products: new Map() };
      const key = r.productId ?? `req:${r.id}`;
      trip.products.set(key, [...(trip.products.get(key) ?? []), r]);
      byTrip.set(r.tripId, trip);
    }
    return [...byTrip.entries()];
  }, [data, dterm]);

  const count = data?.length ?? 0;
  const flat = useMemo(() => groups.flatMap(([, trip]) => [...trip.products.values()].flat()), [groups]);
  const [cursor, setCursor] = useState<string | null>(null);
  const hud = useHud();
  const quick = useTenantAction<{ id: string; body: { result: "obtained" } }>("post", (i) => `/items/${i.id}/decide`, "Ditandai dapat", { silentOffline: true });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || picked || !flat.length) return;
      const k = e.key.toLowerCase();
      const i = flat.findIndex((x) => x.id === cursor);
      if (k === "j" || k === "k") setCursor(flat[Math.max(0, Math.min(flat.length - 1, i + (k === "j" ? 1 : -1)))]!.id);
      else if (k === "enter" && i >= 0) setPicked(flat[i]!);
      else if (k === "e" && i >= 0) {
        const item = flat[i]!;
        const queue = () => enqueue({ tenantBase: t.base, itemId: item.id, title: `${item.title} · ${item.customer}`, body: { result: "obtained" } }).then(() => hud("Disimpan, dikirim saat ada sinyal"));
        if (!navigator.onLine) void queue();
        else quick.mutate({ id: item.id, body: { result: "obtained" } }, { onError: (err) => err instanceof ApiError && err.status === 0 && void queue() });
        setCursor(flat[i + 1]?.id ?? null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, cursor, picked, t.base, quick, hud]);

  return (
    <Screen title="Belanja" accessory={count > 6 ? <SearchField value={term} onChange={setTerm} placeholder="Cari barang atau pelanggan" /> : undefined}>
      <SyncBanner pending={pending} offline={!online} />
      {!data && q.isPending && <SkeletonRows rows={6} />}
      {!data && q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {data && count === 0 && (
        <EmptyState
          icon={<CheckCircle2 />}
          title="Daftar belanja kosong"
          body="Barang muncul di sini setelah pesanan dikonfirmasi dan DP-nya lunas."
          action={<Button onClick={() => navigate("/pesanan")}>Lihat pesanan</Button>}
        />
      )}
      {groups.map(([tripId, trip]) => (
        <div key={tripId}>
          <h2 className="mb-3 mt-2 px-1 text-title3">{trip.title}</h2>
          {[...trip.products.entries()].map(([key, items]) => {
            const first = items[0]!;
            const totalQty = items.reduce((s, i) => s + i.qty, 0);
            return (
              <ListSection
                key={key}
                header={`${first.title} · ${totalQty} pcs`}
                footer={first.link ? <a href={safeHref(first.link)} target="_blank" rel="noopener noreferrer" className="break-all text-tint-text">{first.link}</a> : first.note ?? undefined}
              >
                {items.map((i) => (
                  <ListRow
                    key={i.id}
                    icon={i.photoKey ? <img src={media(i.photoKey)!} alt="" className="size-full rounded-[8px] object-cover" /> : <ShoppingBag />}
                    iconBg={i.photoKey ? "transparent" : "var(--indigo)"}
                    title={`${i.customer}${i.variant ? ` · ${i.variant}` : ""}`}
                    subtitle={`${i.qty} pcs · ${i.orderCode}${i.maxPriceMinor !== null ? ` · maks ${formatForeign(i.maxPriceMinor, i.currency)}` : ""}`}
                    trailing={queued.has(i.id) ? <Pill tone="gray">Menunggu sinyal</Pill> : i.status === "needs_approval" ? <ItemPill status={i.status} /> : undefined}
                    chevron
                    selected={cursor === i.id}
                    onClick={() => setPicked(i)}
                  />
                ))}
              </ListSection>
            );
          })}
        </div>
      ))}
      <DecideSheet item={picked} onClose={() => setPicked(null)} />
    </Screen>
  );
}
