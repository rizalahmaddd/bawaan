import { feature } from "../lib/features";
import type { Integrations } from "./integrations";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const emailEnabled = (env: Env) => feature(env, "email") && !!(env.RESEND_API_KEY && env.EMAIL_FROM);

/** Plain, single-column mail that renders the same in Gmail and Apple Mail. */
export function emailHtml(title: string, body: string, link?: string | null, cta = "Buka") {
  return `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#fff;border-radius:20px;padding:28px">
<p style="margin:0 0 6px;color:#6b6b70;font-size:13px">${escape(title)}</p>
<p style="margin:0 0 20px;color:#111;font-size:17px;line-height:1.45">${escape(body)}</p>
${link ? `<a href="${escape(link)}" style="display:inline-block;background:#007aff;color:#fff;text-decoration:none;border-radius:999px;padding:12px 22px;font-weight:600">${escape(cta)}</a>` : ""}
</div>
<p style="color:#8e8e93;font-size:12px;text-align:center;margin-top:16px">Dikirim lewat Bawaan</p>
</div></body></html>`;
}

export async function sendEmail(env: Env, msg: { to: string; subject: string; text: string; html: string }) {
  if (!emailEnabled(env)) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) console.error("email failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

/**
 * Business-initiated WhatsApp messages must use a template Meta approved beforehand. The seller's
 * template takes one body variable, which carries our message text.
 */
export async function sendWhatsApp(cfg: NonNullable<Integrations["waCloud"]>, toE164: string, text: string) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164.replace(/\D/g, ""),
      type: "template",
      template: { name: cfg.templateName, language: { code: cfg.language }, components: [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 1000) }] }] },
    }),
  });
  if (!res.ok) console.error("whatsapp failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}
