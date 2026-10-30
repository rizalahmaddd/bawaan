import { formatRupiah, PRO_PRICE_IDR } from "@bawaan/shared";
import { useEffect, type ReactNode } from "react";
import { LinkButton } from "../ui/Button";
import { surfaceUrl } from "../lib/links";
import { Wordmark } from "../ui/Logo";

const CONTACT = "malang.tech.id@gmail.com";
const UPDATED = "30 Oktober 2026";

export type LegalPage = "privasi" | "syarat";

export default function Legal({ page }: { page: LegalPage }) {
  const doc = page === "privasi" ? privacy : terms;
  useEffect(() => {
    document.title = `${doc.title} · Bawaan`;
  }, [doc.title]);
  return (
    <div className="min-h-dvh overflow-x-clip bg-bg">
      <header className="sticky top-0 z-30 pt-[var(--safe-top)]">
        <div className="glass mx-auto mt-2 flex h-14 w-[min(760px,calc(100%-24px))] items-center justify-between rounded-full pl-4 pr-2">
          <a href={surfaceUrl("landing")} aria-label="Bawaan">
            <Wordmark />
          </a>
          <LinkButton href={surfaceUrl("app")} size="sm">Masuk</LinkButton>
        </div>
      </header>
      <main className="mx-auto w-[min(760px,calc(100%-32px))] py-10">
        <h1 className="text-[clamp(1.9rem,5vw,2.6rem)] font-bold tracking-[-0.03em]">{doc.title}</h1>
        <p className="mt-2 text-footnote text-label-2">Terakhir diperbarui {UPDATED}</p>
        <div className="mt-8 space-y-8 text-body leading-relaxed">
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="mb-2 text-title3">{s.heading}</h2>
              <div className="space-y-3 text-label-2 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-label">{s.body}</div>
            </section>
          ))}
        </div>
      </main>
      <footer className="mx-auto flex w-[min(760px,calc(100%-32px))] flex-wrap gap-x-5 gap-y-2 border-t-[0.5px] border-separator py-8 pb-[max(var(--safe-bottom),32px)] text-footnote text-label-2">
        <a href={surfaceUrl("landing")}>Beranda</a>
        <a href={surfaceUrl("landing", "/privasi")}>Kebijakan privasi</a>
        <a href={surfaceUrl("landing", "/syarat")}>Syarat layanan</a>
      </footer>
    </div>
  );
}

const privacy: { title: string; sections: { heading: string; body: ReactNode }[] } = {
  title: "Kebijakan Privasi",
  sections: [
    {
      heading: "Siapa kami",
      body: (
        <p>
          Bawaan (bawaan.my.id) adalah aplikasi untuk seller jasa titip (jastip) mengelola pesanan, tagihan, dan pengiriman. Kebijakan ini menjelaskan data apa yang kami
          simpan, untuk apa, dan bagaimana kamu bisa memintanya dihapus.
        </p>
      ),
    },
    {
      heading: "Data yang kami simpan",
      body: (
        <>
          <p><strong>Seller dan anggota tim</strong>: nama, alamat email, dan foto profil dari akun Google atau Apple yang dipakai untuk masuk; data toko seperti nama toko, nomor WhatsApp, rekening bank, dan kebijakan toko.</p>
          <p><strong>Pelanggan toko</strong>: nama, nomor WhatsApp, alamat kirim (kalau diisi), isi pesanan, bukti transfer, dan riwayat pembayaran. Data ini diisi oleh pelanggan saat memesan atau oleh seller.</p>
          <p><strong>Teknis</strong>: cookie sesi supaya kamu tetap masuk, langganan notifikasi browser kalau kamu menyalakannya, dan log akses singkat untuk keamanan dan mencegah penyalahgunaan.</p>
        </>
      ),
    },
    {
      heading: "Untuk apa data dipakai",
      body: (
        <ul>
          <li>Menjalankan layanan: menampilkan pesanan, membuat tagihan, mengirim kabar status ke pelanggan.</li>
          <li>Masuk dengan Google atau Apple. Kami hanya meminta nama, email, dan foto profil, tidak mengakses Gmail, Drive, atau data Google lainnya.</li>
          <li>Keamanan: membatasi spam pesanan dan memeriksa laporan toko yang mencurigakan.</li>
        </ul>
      ),
    },
    {
      heading: "Siapa yang bisa melihat data",
      body: (
        <>
          <p>Data pelanggan hanya bisa dilihat oleh seller toko tempat ia memesan dan tim seller tersebut. Pelanggan melihat pesanannya sendiri lewat link pribadi atau kode pesanan dengan 4 digit terakhir nomor WhatsApp.</p>
          <p>Kami tidak menjual data dan tidak memakainya untuk iklan. Data disimpan di infrastruktur Cloudflare (database, penyimpanan file, dan server) yang kami pakai untuk menjalankan Bawaan.</p>
        </>
      ),
    },
    {
      heading: "Berapa lama data disimpan",
      body: (
        <p>
          Data disimpan selama toko aktif. Kalau seller menghapus toko, ada masa tenggang 7 hari untuk membatalkan; setelah 30 hari data pribadi pelanggan dihapus permanen, sedangkan
          catatan transaksi tanpa identitas disimpan untuk keperluan pembukuan. Seller bisa mengunduh semua data tokonya kapan saja dari Pengaturan.
        </p>
      ),
    },
    {
      heading: "Hak kamu",
      body: (
        <p>
          Kamu bisa meminta salinan, perbaikan, atau penghapusan data pribadimu. Pelanggan bisa menghubungi seller tokonya langsung, atau menghubungi kami di{" "}
          <a className="text-tint-text" href={`mailto:${CONTACT}`}>{CONTACT}</a>. Kami menjawab paling lambat 14 hari kerja.
        </p>
      ),
    },
  ],
};

const terms: typeof privacy = {
  title: "Syarat Layanan",
  sections: [
    {
      heading: "Layanan",
      body: (
        <p>
          Bawaan menyediakan halaman toko, pencatatan pesanan, tagihan, dan pelacakan kiriman untuk seller jastip. Dengan membuat toko atau memesan lewat toko di Bawaan, kamu
          menyetujui syarat ini.
        </p>
      ),
    },
    {
      heading: "Peran seller dan pelanggan",
      body: (
        <>
          <p>Transaksi jual beli terjadi antara seller dan pelanggan. Pembayaran ditransfer langsung ke rekening seller, bukan ke Bawaan. Seller bertanggung jawab atas barang, harga, kebijakan DP, pengembalian dana, dan pengirimannya.</p>
          <p>Bawaan tidak menjamin ketersediaan barang dan tidak menjadi pihak dalam sengketa antara seller dan pelanggan, tetapi akan menindaklanjuti laporan penipuan atau penyalahgunaan.</p>
        </>
      ),
    },
    {
      heading: "Yang tidak boleh",
      body: (
        <ul>
          <li>Menjual barang terlarang menurut hukum Indonesia atau negara asal barang, termasuk barang palsu dan barang yang dilarang masuk oleh Bea Cukai.</li>
          <li>Memakai Bawaan untuk menipu, mengumpulkan uang tanpa niat mengirim barang, atau menyamar sebagai toko lain.</li>
          <li>Mengganggu layanan, misalnya dengan spam pesanan atau mencoba mengakses data toko lain.</li>
        </ul>
      ),
    },
    {
      heading: "Paket dan pembayaran",
      body: (
        <p>
          Paket Gratis bisa dipakai tanpa biaya dengan batasan yang tertera di aplikasi. Paket Pro {formatRupiah(PRO_PRICE_IDR)} per bulan dibayar di muka dan tidak diperpanjang
          otomatis. Biaya yang sudah dibayar tidak dikembalikan, kecuali layanan tidak bisa dipakai karena kesalahan kami.
        </p>
      ),
    },
    {
      heading: "Penangguhan dan penghentian",
      body: (
        <p>
          Kami bisa menangguhkan toko yang melanggar syarat ini atau dilaporkan melakukan penipuan, setelah memeriksa laporannya. Seller bisa menutup sementara atau menghapus tokonya
          sendiri kapan saja dari Pengaturan.
        </p>
      ),
    },
    {
      heading: "Batas tanggung jawab",
      body: (
        <p>
          Layanan disediakan apa adanya. Kami berusaha menjaga Bawaan tetap berjalan dan data tetap aman, tetapi tidak bertanggung jawab atas kerugian tidak langsung, termasuk
          kehilangan keuntungan, yang timbul dari pemakaian layanan. Syarat ini tunduk pada hukum Republik Indonesia.
        </p>
      ),
    },
    {
      heading: "Kontak",
      body: (
        <p>
          Pertanyaan tentang syarat ini bisa dikirim ke <a className="text-tint-text" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      ),
    },
  ],
};
