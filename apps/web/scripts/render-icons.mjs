// Renders PNG icons and the OG image from public/favicon.svg. Run: node scripts/render-icons.mjs
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;

// iOS masks touch icons itself, so those get a full-bleed square, not our squircle.
const square = svg.replace(/<path d="M32 0c19\.8[^>]*\/>/, '<rect width="64" height="64" fill="url(#g)"/>');

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(html, width, height, file) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
  await page.screenshot({ path: out(file), omitBackground: true });
}

const icon = (s, pad = 0) =>
  `<div style="width:${s}px;height:${s}px;display:grid;place-items:center;background:#0a7cff">
     <div style="width:${s - pad * 2}px;height:${s - pad * 2}px">${square.replace("<svg ", '<svg width="100%" height="100%" ')}</div></div>`;

await shot(icon(180), 180, 180, "apple-touch-icon.png");
await shot(icon(192), 192, 192, "icon-192.png");
await shot(icon(512), 512, 512, "icon-512.png");
await shot(icon(512, 64), 512, 512, "icon-maskable-512.png");

await shot(
  `<div style="width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;
     background:radial-gradient(900px 500px at 85% 20%,#d8e9ff,#f2f2f7);font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif">
     <div style="width:220px;height:220px;flex-shrink:0">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
     <div>
       <div style="font-size:88px;font-weight:800;letter-spacing:-3px;color:#000">bawaan</div>
       <div style="font-size:40px;line-height:1.25;color:#3c3c43;margin-top:12px">Jastip rapi, pelanggan tenang.</div>
       <div style="font-size:28px;color:#0040dd;margin-top:28px;font-weight:600">bawaan.my.id</div>
     </div></div>`,
  1200,
  630,
  "og.png",
);

await browser.close();
console.log("icons rendered");
