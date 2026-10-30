import { PLAN_LABEL } from "@bawaan/shared";
import { Crown, Download, Globe, Link2, MessageCircle, PauseCircle, QrCode, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { navigate } from "../../lib/router";
import type { Settings } from "../../lib/types";
import { Button } from "../../ui/Button";
import { ask, useHud } from "../../ui/Feedback";
import { Field, Input } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Sheet } from "../../ui/Sheet";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { ROOT_DOMAIN, storeHost } from "../../lib/links";

type Integrations = {
  xendit: { connected: boolean; keyHint?: string };
  waCloud: { connected: boolean; phoneNumberId?: string; templateName?: string };
  webhookUrl: string;
};
type Capabilities = { plan: string; courier: boolean; domains: boolean; qris: boolean; waCloud: boolean; available: { qris: boolean; waCloud: boolean } };
type DomainData = {
  enabled: boolean;
  allowed: boolean;
  domain: { hostname: string; status: string; sslStatus: string | null; active: boolean; cnameTarget: string; txt: { name: string; value: string } | null; errors: string[] } | null;
};

/** Plan, address, domain, integrations and the danger zone; shown inside Pengaturan. */
export function StoreSettingsSections({ s }: { s: Settings }) {
  const t = useTenant();
  const [sheet, setSheet] = useState<null | "slug" | "domain" | "xendit" | "wa" | "delete">(null);
  const owner = t.role === "owner";
  const pause = useTenantAction<{ paused: boolean }>("post", "/settings/pause", "Tersimpan");
  const restore = useTenantAction("post", "/settings/restore", "Penghapusan dibatalkan");
  const paused = s.tenant.status === "readonly" && !s.tenant.deletedAt;
  const canRename = !s.tenant.slugChangedAt || Date.now() - s.tenant.slugChangedAt > 30 * 86_400_000;
  const caps = useTenantQuery<Capabilities>(["capabilities"], "/capabilities");
  const showDomain = !!caps.data?.domains || !!s.tenant.customDomain;
  const showIntegrations = !!caps.data && (caps.data.available.qris || caps.data.available.waCloud);

  return (
    <>
      {s.tenant.status === "suspended" && (
        <ListSection footer={s.tenant.statusReason ?? undefined}>
          <ListRow title="Toko dibekukan oleh Bawaan" subtitle="Hubungi dukungan Bawaan untuk informasi lebih lanjut." />
        </ListSection>
      )}
      {s.tenant.deletedAt && (
        <ListSection footer="Sampai tanggal itu kamu masih bisa membatalkan dan mengunduh semua data.">
          <ListRow icon={<Trash2 />} iconBg="var(--red)" title="Toko dijadwalkan dihapus" subtitle={`Dihapus permanen ${fmtDate(s.tenant.deletedAt + 7 * 86_400_000)}`} />
          {owner && <ListRow title="Batalkan penghapusan" onClick={() => restore.mutate(undefined)} />}
        </ListSection>
      )}

      <ListSection header="Paket">
        <ListRow icon={<Crown />} iconBg={s.tenant.plan === "pro" ? "var(--orange)" : "var(--gray)"} title={`Paket ${PLAN_LABEL[s.tenant.plan]}`} subtitle={s.tenant.plan === "pro" && s.tenant.planUntil ? `Aktif sampai ${fmtDate(s.tenant.planUntil)}` : "Upgrade untuk trip & staf tanpa batas"} chevron onClick={() => navigate("/paket")} />
      </ListSection>

      <ListSection header="Alamat toko" footer={canRename ? "Ganti maksimal sekali per 30 hari. Link lama tetap diarahkan ke alamat baru selama 90 hari." : `Bisa diganti lagi mulai ${fmtDate((s.tenant.slugChangedAt ?? 0) + 30 * 86_400_000)}.`}>
        <ListRow icon={<Link2 />} title={s.storeUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, "")} chevron={owner && canRename} onClick={owner && canRename ? () => setSheet("slug") : undefined} />
        {showDomain && (owner || s.tenant.customDomain) && (
          <ListRow icon={<Globe />} iconBg="var(--indigo)" title="Domain sendiri" value={s.tenant.customDomain ?? (s.tenant.plan === "pro" ? "Belum" : "Pro")} chevron={owner} onClick={owner ? () => setSheet("domain") : undefined} />
        )}
      </ListSection>

      {t.canSettings && showIntegrations && (
        <ListSection header="Integrasi" footer="Opsional. Pembayaran QRIS otomatis masuk ke akun Xendit-mu sendiri; WhatsApp API mengirim kabar tanpa perlu tap kirim satu per satu (biaya pesan dari Meta).">
          <IntegrationRows available={caps.data!.available} onOpen={(k) => setSheet(k)} />
        </ListSection>
      )}

      {t.canSettings && (
        <ListSection header="Data & toko" footer="Unduhan berisi semua pelanggan, pesanan, tagihan, dan pembayaran dalam CSV.">
          <ListRow icon={<Download />} iconBg="var(--green)" title="Unduh semua data (.zip)" href={`${t.base}/export.zip`} />
          {!s.tenant.deletedAt && s.tenant.status !== "suspended" && (
            <ListRow
              icon={<PauseCircle />}
              iconBg="var(--orange)"
              title={paused ? "Buka toko lagi" : "Tutup sementara"}
              subtitle={paused ? "Toko sedang tidak menerima pesanan baru" : "Berhenti terima pesanan baru; link lacak tetap jalan"}
              onClick={() => pause.mutate({ paused: !paused })}
            />
          )}
          {owner && !s.tenant.deletedAt && <ListRow icon={<Trash2 />} iconBg="var(--red)" title="Hapus toko" destructive onClick={() => setSheet("delete")} />}
        </ListSection>
      )}

      {sheet === "slug" && <SlugSheet current={s.tenant.slug} onClose={() => setSheet(null)} />}
      {sheet === "domain" && <DomainSheet onClose={() => setSheet(null)} />}
      {sheet === "xendit" && <XenditSheet onClose={() => setSheet(null)} />}
      {sheet === "wa" && <WaCloudSheet onClose={() => setSheet(null)} />}
      {sheet === "delete" && <DeleteSheet slug={s.tenant.slug} onClose={() => setSheet(null)} />}
    </>
  );
}

function IntegrationRows({ available, onOpen }: { available: Capabilities["available"]; onOpen: (k: "xendit" | "wa") => void }) {
  const q = useTenantQuery<Integrations>(["integrations"], "/integrations");
  const status = (on?: boolean) => <Pill tone={on ? "green" : "gray"}>{on ? "Tersambung" : "Belum"}</Pill>;
  return (
    <>
      {available.qris && <ListRow icon={<QrCode />} iconBg="var(--teal)" title="QRIS otomatis (Xendit)" trailing={status(q.data?.xendit.connected)} chevron onClick={() => onOpen("xendit")} />}
      {available.waCloud && <ListRow icon={<MessageCircle />} iconBg="var(--green)" title="WhatsApp Cloud API" trailing={status(q.data?.waCloud.connected)} chevron onClick={() => onOpen("wa")} />}
    </>
  );
}

function SlugSheet({ current, onClose }: { current: string; onClose: () => void }) {
  const t = useTenant();
  const hud = useHud();
  const [slug, setSlug] = useState(current);
  const [check, setCheck] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Ganti alamat toko" detents={["medium"]}>
      <ListSection footer={check && !check.ok ? check.reason : "Huruf kecil, angka, dan tanda hubung. 3–30 karakter."}>
        <Field label="Alamat">
          {(id) => (
            <div className="flex items-center justify-end gap-1">
              <Input
                id={id}
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  setCheck(null);
                }}
                onBlur={() => slug !== current && api.get<{ ok: boolean; reason?: string }>(`/api/tenants/slug-check?slug=${encodeURIComponent(slug)}`).then(setCheck).catch(() => {})}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <span className="shrink-0 text-body text-label-2">.{ROOT_DOMAIN}</span>
            </div>
          )}
        </Field>
      </ListSection>
      <Button
        size="lg"
        block
        disabled={busy || slug === current || check?.ok === false}
        onClick={async () => {
          if (!(await ask(`Ganti alamat jadi ${storeHost(slug)}? Bisa diganti lagi setelah 30 hari.`, { action: "Ganti" }))) return;
          setBusy(true);
          try {
            await api.post(`${t.base}/settings/slug`, { slug });
            hud("Alamat toko diganti");
            location.reload();
          } catch (e) {
            hud(errorMessage(e), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        Ganti alamat
      </Button>
    </Sheet>
  );
}

function DomainSheet({ onClose }: { onClose: () => void }) {
  const q = useTenantQuery<DomainData>(["domain"], "/domain");
  const [host, setHost] = useState("");
  const add = useTenantAction<{ hostname: string }>("put", "/domain", "Domain ditambahkan");
  const remove = useTenantAction("del", "/domain", "Domain dilepas");
  const d = q.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Domain sendiri" detents={["large"]}>
      {!d ? null : !d.allowed ? (
        <ListSection footer="Pakai domain sendiri seperti toko.namamu.com untuk tokomu.">
          <ListRow icon={<Crown />} iconBg="var(--orange)" title="Tersedia di paket Pro" chevron onClick={() => (onClose(), navigate("/paket"))} />
        </ListSection>
      ) : !d.enabled ? (
        <ListSection>
          <ListRow title="Fitur domain sendiri belum dibuka" subtitle="Segera tersedia." />
        </ListSection>
      ) : d.domain ? (
        <>
          <ListSection footer={d.domain.active ? "Domain aktif dan SSL sudah terpasang." : "Pengecekan berjalan otomatis; biasanya beberapa menit setelah DNS diubah."}>
            <ListRow title={d.domain.hostname} trailing={<Pill tone={d.domain.active ? "green" : "orange"}>{d.domain.active ? "Aktif" : "Menunggu DNS"}</Pill>} />
            {d.domain.errors.map((e) => (
              <ListRow key={e} title={e} />
            ))}
          </ListSection>
          {!d.domain.active && (
            <ListSection header="Atur DNS di penyedia domainmu">
              <ListRow title="CNAME" subtitle={`${d.domain.hostname} → ${d.domain.cnameTarget}`} />
              {d.domain.txt && <ListRow title="TXT" subtitle={`${d.domain.txt.name} = ${d.domain.txt.value}`} />}
            </ListSection>
          )}
          <div className="flex gap-3">
            <Button variant="gray" className="flex-1" onClick={() => q.refetch()}>
              Cek lagi
            </Button>
            <Button variant="destructive" className="flex-1" disabled={remove.isPending} onClick={async () => (await ask("Lepas domain ini dari toko?", { action: "Lepas", destructive: true })) && remove.mutate(undefined)}>
              Lepas domain
            </Button>
          </div>
        </>
      ) : (
        <>
          <ListSection footer="Masukkan subdomain milikmu, lalu arahkan CNAME-nya sesuai petunjuk berikutnya.">
            <Field label="Domain">{(id) => <Input id={id} value={host} onChange={(e) => setHost(e.target.value)} placeholder="toko.namamu.com" autoCapitalize="none" inputMode="url" />}</Field>
          </ListSection>
          <Button size="lg" block disabled={host.trim().length < 4 || add.isPending} onClick={() => add.mutate({ hostname: host.trim() })}>
            Tambahkan
          </Button>
        </>
      )}
    </Sheet>
  );
}

function XenditSheet({ onClose }: { onClose: () => void }) {
  const t = useTenant();
  const q = useTenantQuery<Integrations>(["integrations"], "/integrations");
  const hud = useHud();
  const [secretKey, setSecretKey] = useState("");
  const [callbackToken, setCallbackToken] = useState("");
  const save = useTenantAction<object>("put", "/integrations", "Tersimpan");
  const connected = q.data?.xendit.connected;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="QRIS otomatis" detents={["large"]}>
      <ListSection
        header="Langkah"
        footer="Pelanggan membayar QRIS dengan nominal pas, lalu tagihan langsung lunas tanpa cek mutasi. Biaya transaksi mengikuti tarif Xendit."
      >
        <ol className="list-decimal space-y-1.5 py-4 pl-9 pr-4 text-subhead">
          <li>Daftar dan aktifkan QRIS di dashboard Xendit.</li>
          <li>Buat Secret Key dengan izin Money-in (write).</li>
          <li>Di menu Webhook, isi URL QR code paid dengan alamat di bawah, lalu salin Verification Token.</li>
        </ol>
      </ListSection>
      <ListSection header="URL webhook">
        <ListRow title={q.data?.webhookUrl ?? "…"} onClick={() => q.data && navigator.clipboard?.writeText(q.data.webhookUrl).then(() => hud("Disalin"))} />
      </ListSection>
      <ListSection footer={connected ? `Tersambung dengan key ${q.data?.xendit.keyHint}. Isi ulang untuk mengganti.` : undefined}>
        <Field label="Secret key">{(id) => <Input id={id} value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="xnd_production_…" autoComplete="off" />}</Field>
        <Field label="Verification token">{(id) => <Input id={id} value={callbackToken} onChange={(e) => setCallbackToken(e.target.value)} autoComplete="off" />}</Field>
      </ListSection>
      <div className="flex gap-3">
        {connected && (
          <Button variant="destructive" className="flex-1" disabled={save.isPending || t.role !== "owner"} onClick={() => save.mutate({ xendit: null }, { onSuccess: onClose })}>
            Putuskan
          </Button>
        )}
        <Button className="flex-1" disabled={save.isPending || secretKey.length < 10 || callbackToken.length < 10 || t.role !== "owner"} onClick={() => save.mutate({ xendit: { secretKey: secretKey.trim(), callbackToken: callbackToken.trim() } }, { onSuccess: onClose })}>
          Simpan
        </Button>
      </div>
    </Sheet>
  );
}

function WaCloudSheet({ onClose }: { onClose: () => void }) {
  const t = useTenant();
  const q = useTenantQuery<Integrations>(["integrations"], "/integrations");
  const [f, setF] = useState({ phoneNumberId: "", accessToken: "", templateName: "", language: "id" });
  const save = useTenantAction<object>("put", "/integrations", "Tersimpan");
  const connected = q.data?.waCloud.connected;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="WhatsApp Cloud API" detents={["large"]}>
      <ListSection
        header="Sebelum mulai"
        footer="Template harus disetujui Meta dan punya satu variabel isi ({{1}}), misalnya: “Kabar pesananmu: {{1}}”. Setiap pesan dikenai biaya oleh Meta."
      >
        <ol className="list-decimal space-y-1.5 py-4 pl-9 pr-4 text-subhead">
          <li>Buat aplikasi WhatsApp Business di Meta for Developers.</li>
          <li>Salin Phone number ID dan buat access token permanen (System User).</li>
          <li>Ajukan template pesan kategori Utility.</li>
        </ol>
      </ListSection>
      <ListSection footer={connected ? `Tersambung: ${q.data?.waCloud.phoneNumberId}, template ${q.data?.waCloud.templateName}.` : undefined}>
        <Field label="Phone number ID">{(id) => <Input id={id} value={f.phoneNumberId} onChange={set("phoneNumberId")} inputMode="numeric" />}</Field>
        <Field label="Access token">{(id) => <Input id={id} value={f.accessToken} onChange={set("accessToken")} autoComplete="off" />}</Field>
        <Field label="Nama template">{(id) => <Input id={id} value={f.templateName} onChange={set("templateName")} placeholder="kabar_pesanan" autoCapitalize="none" />}</Field>
        <Field label="Bahasa">{(id) => <Input id={id} value={f.language} onChange={set("language")} />}</Field>
      </ListSection>
      <div className="flex gap-3">
        {connected && (
          <Button variant="destructive" className="flex-1" disabled={save.isPending || t.role !== "owner"} onClick={() => save.mutate({ waCloud: null }, { onSuccess: onClose })}>
            Putuskan
          </Button>
        )}
        <Button
          className="flex-1"
          disabled={save.isPending || !f.phoneNumberId || f.accessToken.length < 20 || !f.templateName || t.role !== "owner"}
          onClick={() => save.mutate({ waCloud: { ...f, phoneNumberId: f.phoneNumberId.trim(), accessToken: f.accessToken.trim(), templateName: f.templateName.trim() } }, { onSuccess: onClose })}
        >
          Simpan
        </Button>
      </div>
    </Sheet>
  );
}

function DeleteSheet({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const del = useTenantAction<{ confirmSlug: string }>("post", "/settings/delete", "Toko dijadwalkan dihapus");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Hapus toko" detents={["large"]}>
      <ListSection header="Yang terjadi">
        <ul className="list-disc space-y-1.5 py-4 pl-9 pr-4 text-subhead">
          <li>Toko langsung berhenti menerima pesanan. Link lacak pelanggan tetap bisa dibuka selama 7 hari.</li>
          <li>Selama 7 hari kamu bisa membatalkan dan mengunduh semua data.</li>
          <li>Setelah itu toko ditutup permanen; alamat {slug} tidak bisa dipakai siapa pun selama 180 hari.</li>
          <li>30 hari setelah dihapus, data pribadi pelanggan dihapus permanen.</li>
        </ul>
      </ListSection>
      <ListSection footer={`Ketik ${slug} untuk konfirmasi.`}>
        <Field label="Alamat toko">{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" />}</Field>
      </ListSection>
      <Button size="lg" variant="destructive" block disabled={typed.trim().toLowerCase() !== slug || del.isPending} onClick={() => del.mutate({ confirmSlug: typed.trim() }, { onSuccess: onClose })}>
        Hapus toko
      </Button>
    </Sheet>
  );
}
