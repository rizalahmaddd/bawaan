/**
 * Absolute URLs for each surface. Production uses real subdomains; preview and dev serve everything
 * from one origin and pick the surface with ?host=.
 */
export function origins(env: Env, requestUrl: string) {
  const prod = env.ENVIRONMENT === "production";
  const origin = new URL(requestUrl).origin;
  const root = env.ROOT_DOMAIN;
  const withHost = (host: string, path: string) => {
    const u = new URL(path, origin);
    u.searchParams.set("host", host);
    return u.toString();
  };
  return {
    app: (path = "/") => (prod ? new URL(path, `https://app.${root}`).toString() : withHost("app", path)),
    accounts: (path = "/") => (prod ? new URL(path, `https://accounts.${root}`).toString() : new URL(path, origin).toString()),
    store: (slug: string, path = "/") => (prod ? new URL(path, `https://${slug}.${root}`).toString() : withHost(slug, path)),
  };
}
