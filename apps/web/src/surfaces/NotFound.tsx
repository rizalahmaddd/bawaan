import { LinkButton } from "../ui/Button";
import { LogoMark } from "../ui/Logo";
import { surfaceUrl } from "../lib/links";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <LogoMark className="mb-6 size-16" />
      <h1 className="text-title1">Halaman ini tidak ada</h1>
      <p className="mt-2 max-w-[22rem] text-body text-label-2">Mungkin alamat tokonya salah ketik, atau tokonya belum dibuat.</p>
      <LinkButton href={surfaceUrl("landing")} className="mt-8" size="lg">Ke Bawaan</LinkButton>
    </main>
  );
}
