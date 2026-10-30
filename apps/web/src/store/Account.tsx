import { formatRupiah } from "@bawaan/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { fmtDate } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { Button, LinkButton } from "../ui/Button";
import { ErrorState, PageSpinner, useHud } from "../ui/Feedback";
import { Field, Input } from "../ui/Form";
import { ListRow, ListSection } from "../ui/List";
import { Pill } from "../ui/Pill";
import { Switch } from "../ui/Switch";
import { ORDER_STATUS } from "../seller/common";
import { TrackForm } from "./Catalog";
import { knownOrders, orderToken, saveOrderToken } from "./data";

export type StoreMe = {
  user: { name: string; email: string; avatarUrl: string | null } | null;
  balance?: number;
  orders?: Array<{ code: string; status: string; createdAt: number; tripTitle: string; token: string }>;
  addresses?: Array<{ id: string; recipient: string; line: string; city: string }>;
  googleEnabled: boolean;
  appleEnabled: boolean;
  devLogin: boolean;
};

export const useStoreMe = () => useQuery({ queryKey: ["store-me"], queryFn: ({ signal }) => api.get<StoreMe>("/api/store/me", signal) });

function GoogleButton({ returnTo }: { returnTo: string }) {
  return (
    <LinkButton href={`/api/store/auth/google/start?return=${encodeURIComponent(returnTo)}`} variant="glass" size="lg" block icon={<UserRound className="size-5" />}>
      Masuk dengan Google
    </LinkButton>
  );
}

function DevLogin() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("pelanggan@example.com");
  return (
    <ListSection header="Masuk (khusus pengembangan)">
      <Field label="Email">{(id) => <Input id={id} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <div className="p-4">
        <Button block variant="gray" onClick={() => api.post("/api/store/auth/dev-login", { email }).then(() => qc.invalidateQueries({ queryKey: ["store-me"] }))}>
          Masuk dev
        </Button>
      </div>
    </ListSection>
  );
}

/** "Pesananku": every order linked to the signed-in Google account, plus ones remembered on this device. */
export function Account() {
  const me = useStoreMe();
  const qc = useQueryClient();
  const { search } = useLocation();
  if (me.isPending) return <PageSpinner />;
  if (me.isError) return <ErrorState message={errorMessage(me.error)} onRetry={() => me.refetch()} />;
  const d = me.data;
  for (const o of d.orders ?? []) if (!orderToken(o.code)) saveOrderToken(o.code, o.token);
  const local = knownOrders().filter((c) => !(d.orders ?? []).some((o) => o.code === c));

  return (
    <>
      {search.get("login") && <p className="mb-4 rounded-[14px] bg-fill-4 p-3 text-subhead">Login tidak berhasil. Coba lagi.</p>}
      <TrackForm />
      {!d.user ? (
        <ListSection footer="Tidak wajib. Dengan akun Google, semua pesananmu di toko ini bisa dibuka dari HP mana pun.">
          <div className="space-y-3 p-4">
            {d.googleEnabled && <GoogleButton returnTo="/akun" />}
            {d.appleEnabled && (
              <LinkButton href={`/api/store/auth/apple/start?return=${encodeURIComponent("/akun")}`} variant="glass" size="lg" block>
                Masuk dengan Apple
              </LinkButton>
            )}
            {!d.googleEnabled && !d.appleEnabled && <p className="text-subhead text-label-2">Login belum tersedia di toko ini.</p>}
          </div>
        </ListSection>
      ) : (
        <ListSection>
          <ListRow
            icon={d.user.avatarUrl ? <img src={d.user.avatarUrl} alt="" className="size-full rounded-[8px] object-cover" /> : <UserRound />}
            iconBg={d.user.avatarUrl ? "transparent" : "var(--gray)"}
            title={d.user.name}
            subtitle={d.user.email}
          />
          {(d.balance ?? 0) > 0 && <ListRow title="Saldo di toko ini" value={formatRupiah(d.balance!)} />}
        </ListSection>
      )}
      {!d.user && d.devLogin && <DevLogin />}

      {d.user && (
        <ListSection header="Pesanan di akunmu" footer={(d.orders ?? []).length ? undefined : "Buka link pesanan dari seller, lalu ketuk “Simpan ke akun Google” untuk menyambungkannya."}>
          {(d.orders ?? []).map((o) => (
            <ListRow
              key={o.code}
              icon={<ClipboardList />}
              title={o.code}
              subtitle={`${o.tripTitle} · ${fmtDate(o.createdAt)}`}
              trailing={<Pill tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Pill>}
              chevron
              onClick={() => navigate(`/o/${o.code}?t=${o.token}`)}
            />
          ))}
        </ListSection>
      )}

      {local.length > 0 && (
        <ListSection header="Dibuka di perangkat ini">
          {local.map((c) => (
            <ListRow key={c} icon={<ClipboardList />} iconBg="var(--gray)" title={c} chevron onClick={() => navigate(`/o/${c}?t=${orderToken(c)}`)} />
          ))}
        </ListSection>
      )}

      {d.addresses && d.addresses.length > 0 && (
        <ListSection header="Alamat">
          {d.addresses.map((a) => (
            <ListRow key={a.id} title={a.recipient} subtitle={`${a.line}, ${a.city}`} />
          ))}
        </ListSection>
      )}

      {d.user && (
        <ListSection>
          <ListRow
            icon={<LogOut />}
            iconBg="var(--red)"
            title="Keluar"
            destructive
            onClick={() => api.post("/api/store/auth/logout").then(() => qc.invalidateQueries({ queryKey: ["store-me"] }))}
          />
        </ListSection>
      )}
    </>
  );
}

/** On the tracking page: link this order to the Google account, and ask to hold delivery for combining. */
export function OrderAccountCard({ code, token, linked, hold, active }: { code: string; token: string; linked: boolean; hold: boolean; active: boolean }) {
  const me = useStoreMe();
  const qc = useQueryClient();
  const hud = useHud();
  const [busy, setBusy] = useState(false);
  const headers = { "x-order-token": token };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      hud(ok);
      await qc.invalidateQueries();
    } catch (e) {
      hud(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const user = me.data?.user;
  const showLink = !linked && (user || me.data?.googleEnabled);
  if (!showLink && !active) return null;
  return (
    <>
      {active && (
        <ListSection footer="Seller menahan paket sampai pesananmu yang lain juga sampai, jadi ongkirnya sekali.">
          <ListRow
            title="Gabung kirim dengan pesanan lain"
            trailing={<Switch checked={hold} disabled={busy} aria-label="Gabung kirim" onChange={(e) => run(() => api.post(`/api/store/orders/${code}/hold`, { hold: e.target.checked }, headers), "Tersimpan")} />}
          />
        </ListSection>
      )}
      {showLink && (
        <ListSection>
          {user ? (
            <ListRow icon={<UserRound />} title="Simpan ke akun Google" subtitle={user.email} onClick={() => run(() => api.post(`/api/store/orders/${code}/link`, {}, headers), "Pesanan tersimpan di akunmu")} />
          ) : (
            <ListRow icon={<UserRound />} title="Masuk dengan Google" subtitle="Simpan pesanan ini supaya mudah dibuka lagi" href={`/api/store/auth/google/start?return=${encodeURIComponent(`/o/${code}?t=${token}`)}`} />
          )}
        </ListSection>
      )}
    </>
  );
}
