const CSP = [
  "default-src 'self'",
  // The zone injects the Web Analytics beacon into HTML responses.
  "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].join("; ");

export function withSecurityHeaders(res: Response, env: Env): Response {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "camera=(self), geolocation=(), microphone=(), payment=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  // Vite dev injects inline scripts for HMR, so CSP and HSTS only apply to deployed builds.
  if (env.ENVIRONMENT !== "development") {
    h.set("Content-Security-Policy", CSP);
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return out;
}
