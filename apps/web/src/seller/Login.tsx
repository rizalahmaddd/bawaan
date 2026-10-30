import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { surfaceUrl } from "../lib/links";
import type { Me } from "../lib/types";
import { Button, LinkButton } from "../ui/Button";
import { TextInput } from "../ui/Form";
import { LogoMark } from "../ui/Logo";

const LOGIN_ERRORS: Record<string, string> = {
  batal: "Login dibatalkan.",
  kedaluwarsa: "Sesi login kedaluwarsa, coba lagi.",
  gagal: "Login gagal. Pastikan akun Google-mu aktif lalu coba lagi.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}

export function Login({ me, onDone }: { me: Me; onDone: () => void }) {
  const err = new URLSearchParams(location.search).get("login");
  const [email, setEmail] = useState("seller@contoh.id");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(err ? (LOGIN_ERRORS[err] ?? null) : null);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-[380px] text-center">
        <LogoMark className="mx-auto mb-6 size-20" />
        <h1 className="text-title1">Masuk ke Bawaan</h1>
        <p className="mt-2 text-body text-label-2">Kelola trip, pesanan, dan pembayaran jastip dalam satu tempat.</p>
        {error && (
          <p role="alert" className="mt-5 rounded-[14px] bg-[color-mix(in_srgb,var(--red)_12%,transparent)] px-4 py-3 text-subhead text-red-text">
            {error}
          </p>
        )}
        <div className="mt-8 space-y-3">
          {me.googleEnabled ? (
            <LinkButton href={`/api/auth/google/start?return=${encodeURIComponent(location.pathname + location.search)}`} variant="glass" size="lg" block icon={<GoogleIcon />}>
              Lanjutkan dengan Google
            </LinkButton>
          ) : (
            !me.devLogin && !me.appleEnabled && <p className="text-subhead text-label-2">Login Google sedang disiapkan. Coba lagi nanti.</p>
          )}
          {me.appleEnabled && (
            <LinkButton href={`/api/auth/apple/start?return=${encodeURIComponent(location.pathname + location.search)}`} variant="glass" size="lg" block icon={<AppleIcon />}>
              Lanjutkan dengan Apple
            </LinkButton>
          )}
          {me.devLogin && (
            <form
              className="space-y-3 rounded-[var(--radius-card)] bg-elevated p-4 text-left"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api.post("/api/auth/dev-login", { email });
                  onDone();
                } catch (x) {
                  setError(errorMessage(x));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-footnote text-label-2">Mode pengembangan: masuk tanpa Google.</p>
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" className="rounded-[10px] bg-fill-4 px-3" />
              <Button type="submit" block disabled={busy}>
                Masuk (dev)
              </Button>
            </form>
          )}
        </div>
        <p className="mt-8 text-footnote text-label-2">
          Dengan masuk, kamu menyetujui <a href={surfaceUrl("landing", "/syarat")} className="text-tint-text">syarat layanan</a> dan{" "}
          <a href={surfaceUrl("landing", "/privasi")} className="text-tint-text">kebijakan privasi</a> Bawaan.
        </p>
      </div>
    </main>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M16.37 12.6c.02 2.4 2.1 3.2 2.13 3.21-.02.06-.33 1.14-1.1 2.26-.66.97-1.35 1.93-2.43 1.95-1.06.02-1.4-.63-2.62-.63-1.21 0-1.6.61-2.6.65-1.05.04-1.84-1.05-2.51-2.01-1.37-1.98-2.42-5.6-1.01-8.04.7-1.21 1.95-1.98 3.3-2 1.03-.02 2 .7 2.63.7.63 0 1.81-.86 3.05-.73.52.02 1.98.21 2.92 1.58-.08.05-1.74 1.02-1.72 3.04ZM14.36 5.7c.56-.68.93-1.62.83-2.56-.8.03-1.77.53-2.35 1.21-.52.6-.97 1.56-.85 2.48.9.07 1.81-.45 2.37-1.13Z" />
    </svg>
  );
}
