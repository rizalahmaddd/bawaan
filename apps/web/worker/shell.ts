import type { Surface } from "@bawaan/shared";

type Meta = { title: string; description: string; themeColor: string };

function metaFor(surface: Surface, storeName?: string): Meta {
  const base = { themeColor: "#f2f2f7" };
  switch (surface.kind) {
    case "landing":
      return { ...base, title: "Bawaan — Jastip rapi, pelanggan tenang", description: "Pesanan, invoice, dan status kargo jastip dalam satu link. Pelanggan cek sendiri barangnya dapat atau tidak." };
    case "app":
      return { ...base, title: "Bawaan Seller", description: "Kelola trip, pesanan, pembayaran, dan kargo jastip." };
    case "store":
      return { ...base, title: `${storeName ?? surface.slug} · Jastip`, description: `Pesan jastip dari ${storeName ?? surface.slug} dan cek status barangmu di sini.` };
    default:
      return { ...base, title: "Tidak ditemukan · Bawaan", description: "Halaman ini tidak ada." };
  }
}

/** Fills the SPA shell with per-surface data and meta tags so link previews work without SSR. */
export function rewriteShell(shell: Response, surface: Surface, canonical: string, storeName?: string): Response {
  const meta = metaFor(surface, storeName);
  const slug = surface.kind === "store" ? surface.slug : "";
  return new HTMLRewriter()
    .on("html", {
      element(el) {
        el.setAttribute("data-surface", surface.kind);
        if (slug) el.setAttribute("data-slug", slug);
        if (storeName) el.setAttribute("data-store-name", storeName);
      },
    })
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on("head", {
      element(el) {
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
        el.append(
          [
            `<meta name="description" content="${esc(meta.description)}">`,
            `<meta property="og:title" content="${esc(meta.title)}">`,
            `<meta property="og:description" content="${esc(meta.description)}">`,
            `<meta property="og:type" content="website">`,
            `<meta property="og:url" content="${esc(canonical)}">`,
            `<meta property="og:image" content="${esc(new URL("/icons/og.png", canonical).href)}">`,
            `<meta name="theme-color" content="${meta.themeColor}">`,
          ].join(""),
          { html: true },
        );
      },
    })
    .transform(shell);
}
