const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** Shape only, kept free of zod so the client entry stays small. Existence is a DB question. */
export function isSlugShape(s: string): boolean {
  return SLUG_SHAPE.test(s) && !s.includes("--") && !s.startsWith("xn-");
}
