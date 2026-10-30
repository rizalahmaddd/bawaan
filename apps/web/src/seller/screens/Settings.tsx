import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, type Policy, type TemplateKey } from "@bawaan/shared";
import { ExternalLink, LogOut, Plus, Shield, Trash2, Users } from "lucide-react";
import { navigate } from "../../lib/router";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { media, type Bank, type Me, type Settings as SettingsData } from "../../lib/types";
import { Button } from "../../ui/Button";
import { ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Field, Input, PhotoPicker, TextArea } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { Switch } from "../../ui/Switch";
import { useUpload } from "../common";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";
import { StoreSettingsSections } from "./StoreSettings";

const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  confirmed: "Pesanan dikonfirmasi",
  dp: "Tagihan DP",
  settlement: "Tagihan pelunasan",
  reminder: "Pengingat bayar",
  approval: "Minta persetujuan",
  shipment: "Update kargo",
  delivery: "Dikirim ke pelanggan",
};

export async function logout() {
  await api.post("/api/auth/logout").catch(() => {});
  // The offline cache holds the signed-in user and shopping list; don't leave them on a shared phone.
  await caches?.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
  location.assign("/");
}

export function Settings({ me }: { me: Me }) {
  const t = useTenant();
  const q = useTenantQuery<SettingsData>(["settings"], "/settings");
  const [sheet, setSheet] = useState<null | "profile" | "policy" | "banks" | TemplateKey>(null);

  if (q.isPending) return <Screen title="Pengaturan"><SkeletonRows /></Screen>;
  if (q.isError) return <Screen title="Pengaturan"><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const s = q.data;
  const readOnly = !t.canSettings;

  return (
    <Screen title="Pengaturan">
      <ListSection header="Toko" footer={readOnly ? "Hanya pemilik atau admin yang bisa mengubah pengaturan." : undefined}>
        <ListRow title={s.tenant.name} subtitle={`WhatsApp ${s.tenant.waNumber}`} chevron={!readOnly} onClick={readOnly ? undefined : () => setSheet("profile")} />
        <ListRow icon={<ExternalLink />} title="Buka halaman toko" subtitle={s.storeUrl.replace(/^https?:\/\//, "")} href={s.storeUrl} />
      </ListSection>

      <ListSection header="Kebijakan">
        <ListRow title="DP" value={s.policy.dpPercent ? `${s.policy.dpPercent}%` : "Tanpa DP"} chevron={!readOnly} onClick={readOnly ? undefined : () => setSheet("policy")} />
        <ListRow title="Batas pelunasan" value={`${s.policy.settleDays} hari`} />
        <ListRow title="Kode unik transfer" value={s.policy.uniqueCode ? "Aktif" : "Mati"} />
        <ListRow title="Batas persetujuan" value={`${s.policy.approvalHours} jam`} />
      </ListSection>

      <ListSection header="Rekening & QRIS" footer="Ditampilkan di halaman tagihan pelanggan.">
        {s.banks.map((b) => (
          <ListRow key={b.id} title={`${b.bank} · ${b.number}`} subtitle={`a.n. ${b.holder}${b.qrisKey ? " · QRIS" : ""}`} />
        ))}
        {!readOnly && <ListRow icon={<Plus />} title={s.banks.length ? "Ubah rekening" : "Tambah rekening"} onClick={() => setSheet("banks")} />}
      </ListSection>

      <ListSection header="Template WhatsApp" footer="Variabel: {nama} {kode} {link} {total} {tagihan} {batas} {status} {kurir} {resi}">
        {TEMPLATE_KEYS.map((k) => (
          <ListRow key={k} title={TEMPLATE_LABEL[k]} subtitle={s.policy.templates[k] ? "Diubah" : "Bawaan"} chevron={!readOnly} onClick={readOnly ? undefined : () => setSheet(k)} />
        ))}
      </ListSection>

      <ListSection header="Tim">
        <ListRow icon={<Users />} iconBg="var(--indigo)" title="Anggota tim" value={s.members.length} chevron onClick={() => navigate("/tim")} />
      </ListSection>

      <StoreSettingsSections s={s} />

      {me.platformAdmin && (
        <ListSection header="Bawaan">
          <ListRow icon={<Shield />} iconBg="var(--gray)" title="Platform admin" chevron onClick={() => navigate("/admin")} />
        </ListSection>
      )}

      <ListSection header="Akun" footer={`Masuk sebagai ${me.user?.email}`}>
        <ListRow icon={<LogOut />} iconBg="var(--red)" title="Keluar" destructive onClick={logout} />
      </ListSection>

      {sheet === "profile" && <ProfileSheet s={s} onClose={() => setSheet(null)} />}
      {sheet === "policy" && <PolicySheet policy={s.policy} onClose={() => setSheet(null)} />}
      {sheet === "banks" && <BanksSheet banks={s.banks} onClose={() => setSheet(null)} />}
      {sheet && TEMPLATE_KEYS.includes(sheet as TemplateKey) && <TemplateSheet k={sheet as TemplateKey} policy={s.policy} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

const TINTS = ["#007aff", "#34c759", "#ff9500", "#ff2d55", "#af52de", "#5856d6", "#30b0c7", "#a2845e"];

function ProfileSheet({ s, onClose }: { s: SettingsData; onClose: () => void }) {
  const [name, setName] = useState(s.tenant.name);
  const [wa, setWa] = useState(s.tenant.waNumber);
  const [tint, setTint] = useState<string | null>(s.tenant.tintColor);
  const [logoKey, setLogoKey] = useState(s.tenant.logoKey);
  const logo = useUpload();
  const save = useTenantAction<object>("patch", "/settings", "Tersimpan");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Profil toko" detents={["large"]}>
      <div className="mb-6 flex justify-center">
        <PhotoPicker label="Logo toko" value={media(logoKey)} busy={logo.busy} onPick={async (f) => {
          const key = await logo.upload(f, "logo");
          if (key) setLogoKey(key);
        }} />
      </div>
      <ListSection>
        <Field label="Nama toko">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
        <Field label="WhatsApp">{(id) => <Input id={id} value={wa} onChange={(e) => setWa(e.target.value)} inputMode="tel" />}</Field>
      </ListSection>
      <ListSection header="Warna aksen" footer="Dipakai untuk tombol dan tautan di toko dan aplikasi.">
        <div className="flex flex-wrap gap-3 p-4" role="radiogroup" aria-label="Warna aksen">
          {TINTS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={(tint ?? "#007aff") === c}
              aria-label={c}
              onClick={() => setTint(c === "#007aff" ? null : c)}
              className="size-9 rounded-full ring-offset-2 ring-offset-[var(--bg-elevated)] aria-checked:ring-2 aria-checked:ring-[var(--label)]"
              style={{ background: c }}
            />
          ))}
        </div>
      </ListSection>
      <Button size="lg" block disabled={name.trim().length < 3 || logo.busy || save.isPending} onClick={() => save.mutate({ name: name.trim(), waNumber: wa, tintColor: tint, logoKey }, { onSuccess: () => (onClose(), location.reload()) })}>
        Simpan
      </Button>
    </Sheet>
  );
}

function PolicySheet({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const [p, setP] = useState(policy);
  const save = useTenantAction<{ policy: Partial<Policy> }>("patch", "/settings", "Kebijakan disimpan");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Kebijakan toko" detents={["large"]}>
      <ListSection header="DP default untuk trip baru">
        <div className="p-4">
          <Segmented
            label="DP"
            value={String(p.dpPercent)}
            onChange={(v) => setP({ ...p, dpPercent: Number(v) })}
            options={["0", "30", "50", "100"].map((v) => ({ value: v, label: v === "0" ? "Tanpa" : v === "100" ? "Lunas" : `${v}%` }))}
          />
        </div>
      </ListSection>
      <ListSection footer="Kode unik 1–999 ditambahkan ke nominal supaya transfer mudah dicocokkan di mutasi.">
        <Field label="Batas pelunasan (hari)">{(id) => <Input id={id} value={p.settleDays} onChange={(e) => setP({ ...p, settleDays: Number(e.target.value) || 1 })} inputMode="numeric" />}</Field>
        <Field label="Batas persetujuan (jam)">{(id) => <Input id={id} value={p.approvalHours} onChange={(e) => setP({ ...p, approvalHours: Number(e.target.value) || 1 })} inputMode="numeric" />}</Field>
        <Field label="Kode unik transfer">{(id) => <div className="flex justify-end"><Switch id={id} checked={p.uniqueCode} onChange={(e) => setP({ ...p, uniqueCode: e.target.checked })} /></div>}</Field>
        <Field label="DP hangus jika telat">{(id) => <div className="flex justify-end"><Switch id={id} checked={p.forfeitOnExpiry} onChange={(e) => setP({ ...p, forfeitOnExpiry: e.target.checked })} /></div>}</Field>
      </ListSection>
      <ListSection footer="Dipakai untuk cek ongkir otomatis ke alamat pelanggan.">
        <Field label="Kode pos asal kirim">{(id) => <Input id={id} value={p.originPostalCode ?? ""} onChange={(e) => setP({ ...p, originPostalCode: e.target.value.replace(/\D/g, "").slice(0, 5) || undefined })} inputMode="numeric" placeholder="12345" />}</Field>
      </ListSection>
      <ListSection header="Pengembalian dana default">
        <div className="p-4">
          <Segmented label="Pengembalian" value={p.refundDefault} onChange={(v) => setP({ ...p, refundDefault: v })} options={[{ value: "saldo", label: "Ke saldo" }, { value: "transfer", label: "Transfer" }]} />
        </div>
      </ListSection>
      <ListSection header="Teks kebijakan" footer="Satu poin per baris. Tampil saat checkout dan di tagihan.">
        <div className="px-4 py-2">
          <TextArea value={p.policyText} onChange={(e) => setP({ ...p, policyText: e.target.value })} aria-label="Teks kebijakan" className="min-h-48" maxLength={3000} />
        </div>
      </ListSection>
      <Button
        size="lg"
        block
        disabled={save.isPending}
        onClick={() =>
          save.mutate(
            { policy: { dpPercent: p.dpPercent, settleDays: Math.min(30, p.settleDays), approvalHours: Math.min(168, p.approvalHours), uniqueCode: p.uniqueCode, forfeitOnExpiry: p.forfeitOnExpiry, refundDefault: p.refundDefault, policyText: p.policyText, ...(p.originPostalCode?.length === 5 ? { originPostalCode: p.originPostalCode } : {}) } },
            { onSuccess: onClose },
          )
        }
      >
        Simpan
      </Button>
    </Sheet>
  );
}

function BanksSheet({ banks, onClose }: { banks: Bank[]; onClose: () => void }) {
  const [list, setList] = useState<Bank[]>(banks.length ? banks : [{ bank: "", number: "", holder: "", qrisKey: null }]);
  const qris = useUpload();
  const save = useTenantAction<Bank[]>("put", "/settings/banks", "Rekening disimpan");
  const hud = useHud();
  const patch = (i: number, v: Partial<Bank>) => setList(list.map((b, j) => (j === i ? { ...b, ...v } : b)));
  const filled = list.filter((b) => b.bank.trim() || b.number.trim() || b.holder.trim());
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Rekening" detents={["large"]}>
      {list.map((b, i) => (
        <ListSection
          key={i}
          header={`Rekening ${i + 1}`}
          footer={
            <button type="button" className="inline-flex items-center gap-1 text-red-text" onClick={() => setList(list.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" /> Hapus
            </button>
          }
        >
          <Field label="Bank / e-wallet">{(id) => <Input id={id} value={b.bank} onChange={(e) => patch(i, { bank: e.target.value })} placeholder="BCA" />}</Field>
          <Field label="Nomor">{(id) => <Input id={id} value={b.number} onChange={(e) => patch(i, { number: e.target.value })} inputMode="numeric" />}</Field>
          <Field label="Atas nama">{(id) => <Input id={id} value={b.holder} onChange={(e) => patch(i, { holder: e.target.value })} />}</Field>
          <div className="flex items-center gap-3 px-4 py-3">
            <PhotoPicker label="Gambar QRIS" value={media(b.qrisKey)} busy={qris.busy} onPick={async (f) => {
              const key = await qris.upload(f, "qris");
              if (key) patch(i, { qrisKey: key });
            }} className="w-16" />
            <span className="text-subhead text-label-2">QRIS (opsional)</span>
          </div>
        </ListSection>
      ))}
      <Button variant="gray" block className="mb-4" icon={<Plus className="size-4" />} onClick={() => setList([...list, { bank: "", number: "", holder: "", qrisKey: null }])} disabled={list.length >= 10}>
        Tambah rekening
      </Button>
      <Button
        size="lg"
        block
        disabled={save.isPending || qris.busy}
        onClick={() => {
          if (filled.some((b) => b.bank.trim().length < 2 || b.number.trim().length < 3 || b.holder.trim().length < 2)) return hud("Lengkapi nama bank, nomor, dan atas nama", "error");
          save.mutate(filled.map((b) => ({ bank: b.bank.trim(), number: b.number.trim(), holder: b.holder.trim(), qrisKey: b.qrisKey })), { onSuccess: onClose });
        }}
      >
        Simpan
      </Button>
    </Sheet>
  );
}

function TemplateSheet({ k, policy, onClose }: { k: TemplateKey; policy: Policy; onClose: () => void }) {
  const [text, setText] = useState(policy.templates[k] || DEFAULT_TEMPLATES[k]);
  const save = useTenantAction<{ policy: Partial<Policy> }>("patch", "/settings", "Template disimpan");
  const store = (value: string | undefined) => {
    const templates = { ...policy.templates };
    if (value) templates[k] = value;
    else delete templates[k];
    save.mutate({ policy: { templates } }, { onSuccess: onClose });
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={TEMPLATE_LABEL[k]} detents={["large"]}>
      <ListSection footer="Variabel: {nama} {kode} {link} {total} {tagihan} {batas} {status} {kurir} {resi}">
        <div className="px-4 py-2">
          <TextArea value={text} onChange={(e) => setText(e.target.value)} aria-label="Isi template" className="min-h-40" maxLength={1000} />
        </div>
      </ListSection>
      <div className="flex gap-3">
        <Button variant="gray" className="flex-1" disabled={save.isPending} onClick={() => store(undefined)}>
          Kembalikan bawaan
        </Button>
        <Button className="flex-1" disabled={save.isPending || !text.trim()} onClick={() => store(text.trim() === DEFAULT_TEMPLATES[k] ? undefined : text.trim())}>
          Simpan
        </Button>
      </div>
    </Sheet>
  );
}
