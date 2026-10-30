import { DEFAULT_POLICY_TEXT, checkSlug, suggestSlug } from "@bawaan/shared";
import { Check, ChevronLeft, Copy, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { Button, IconButton } from "../ui/Button";
import { Field, Input, TextInput } from "../ui/Form";
import { ListSection } from "../ui/List";
import { Segmented } from "../ui/Segmented";
import { ROOT_DOMAIN, storeHost } from "../lib/links";

type Step = 0 | 1 | 2 | 3;

export function Onboarding({ onDone }: { onDone: (tenantId: string) => void }) {
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [wa, setWa] = useState("");
  const [bank, setBank] = useState({ bank: "", number: "", holder: "" });
  const [dp, setDp] = useState("50");
  const [settleDays, setSettleDays] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; slug: string } | null>(null);

  useEffect(() => {
    if (!slugTouched) setSlug(suggestSlug(name));
  }, [name, slugTouched]);

  useEffect(() => {
    if (!slug) return setSlugState(null);
    const local = checkSlug(slug);
    if (!local.ok) return setSlugState({ ok: false, reason: local.reason });
    setSlugState(null);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        setSlugState(await api.get<{ ok: boolean; reason?: string }>(`/api/tenants/slug-check?slug=${encodeURIComponent(slug)}`, ctrl.signal));
      } catch {}
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [slug]);

  const storeUrl = storeHost(slug || "namatoko");
  const canNext = [name.trim().length >= 3 && slugState?.ok, wa.replace(/\D/g, "").length >= 9, true, true][step];

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ id: string; slug: string }>("/api/tenants", {
        name,
        slug,
        waNumber: wa,
        bank: bank.bank && bank.number && bank.holder ? bank : undefined,
        dpPercent: Number(dp),
        settleDays: Number(settleDays),
      });
      setCreated(res);
      setStep(3);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const titles = ["Nama toko", "Kontak & pembayaran", "Kebijakan DP", "Toko kamu sudah online"];

  return (
    <main className="mx-auto min-h-dvh max-w-[560px] px-[var(--gutter)] pb-10 pt-[calc(var(--safe-top)+12px)]">
      <div className="flex h-11 items-center">
        {step > 0 && step < 3 && (
          <IconButton label="Kembali" onClick={() => setStep((s) => (s - 1) as Step)}>
            <ChevronLeft className="size-6" />
          </IconButton>
        )}
        <div className="ml-auto flex gap-1.5" aria-label={`Langkah ${step + 1} dari 4`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 w-6 rounded-full ${i <= step ? "bg-tint" : "bg-fill"}`} />
          ))}
        </div>
      </div>
      <h1 className="mb-6 mt-4 text-large-title">{titles[step]}</h1>

      {step === 0 && (
        <ListSection footer={slugState && !slugState.ok ? <span className="text-red-text">{slugState.reason}</span> : `Alamat tokomu: ${storeUrl}`}>
          <Field label="Nama toko">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jastip Ayu" autoFocus maxLength={60} />}</Field>
          <Field label="Alamat">
            {(id) => (
              <div className="flex items-center justify-end gap-1 text-body">
                <TextInput
                  id={id}
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  className="text-right"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={30}
                />
                <span className="text-label-2">.{ROOT_DOMAIN}</span>
                {slugState?.ok && <Check className="size-5 shrink-0 text-green" aria-label="Tersedia" />}
              </div>
            )}
          </Field>
        </ListSection>
      )}

      {step === 1 && (
        <>
          <ListSection footer="Pelanggan menghubungimu lewat nomor ini.">
            <Field label="WhatsApp">{(id) => <Input id={id} value={wa} onChange={(e) => setWa(e.target.value)} placeholder="0812…" inputMode="tel" autoComplete="tel" />}</Field>
          </ListSection>
          <ListSection header="Rekening (bisa diisi nanti)" footer="Ditampilkan di halaman tagihan pelanggan.">
            <Field label="Bank">{(id) => <Input id={id} value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} placeholder="BCA" />}</Field>
            <Field label="No. rekening">{(id) => <Input id={id} value={bank.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} inputMode="numeric" />}</Field>
            <Field label="Atas nama">{(id) => <Input id={id} value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} />}</Field>
          </ListSection>
        </>
      )}

      {step === 2 && (
        <>
          <ListSection header="DP saat pesanan dikonfirmasi">
            <div className="p-4">
              <Segmented
                label="Persentase DP"
                value={dp}
                onChange={setDp}
                options={[
                  { value: "0", label: "Tanpa DP" },
                  { value: "30", label: "30%" },
                  { value: "50", label: "50%" },
                  { value: "100", label: "Lunas" },
                ]}
              />
            </div>
          </ListSection>
          <ListSection header="Batas pelunasan setelah barang Dapat">
            <div className="p-4">
              <Segmented
                label="Batas pelunasan"
                value={settleDays}
                onChange={setSettleDays}
                options={[
                  { value: "1", label: "1 hari" },
                  { value: "3", label: "3 hari" },
                  { value: "7", label: "7 hari" },
                ]}
              />
            </div>
          </ListSection>
          <ListSection header="Teks kebijakan untuk pelanggan" footer="Bisa diubah kapan saja di Pengaturan.">
            <p className="whitespace-pre-line p-4 text-subhead text-label-2">{DEFAULT_POLICY_TEXT}</p>
          </ListSection>
        </>
      )}

      {step === 3 && created && (
        <div className="rounded-[var(--radius-card)] bg-elevated p-6 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--green)_16%,transparent)] text-green">
            <Check className="size-8" strokeWidth={3} />
          </div>
          <p className="text-body text-label-2">Bagikan link ini ke pelanggan setelah trip pertamamu dibuka.</p>
          <p className="mt-3 select-all break-all text-title3 text-tint-text">{storeHost(created.slug)}</p>
          <div className="mt-5 flex justify-center gap-3">
            <Button variant="gray" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard?.writeText(`https://${storeHost(created.slug)}`)}>
              Salin
            </Button>
            {"share" in navigator && (
              <Button variant="gray" icon={<Share className="size-4" />} onClick={() => navigator.share({ url: `https://${storeHost(created.slug)}`, title: name }).catch(() => {})}>
                Bagikan
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-4 text-center text-subhead text-red-text">
          {error}
        </p>
      )}

      <div className="mt-6">
        {step < 2 && (
          <Button size="lg" block disabled={!canNext} onClick={() => setStep((s) => (s + 1) as Step)}>
            Lanjut
          </Button>
        )}
        {step === 2 && (
          <Button size="lg" block disabled={busy} onClick={submit}>
            {busy ? "Membuat toko…" : "Buat toko"}
          </Button>
        )}
        {step === 3 && created && (
          <Button size="lg" block onClick={() => onDone(created.id)}>
            Buka trip pertama
          </Button>
        )}
      </div>
    </main>
  );
}
