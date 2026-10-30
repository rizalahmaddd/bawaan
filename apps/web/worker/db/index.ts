import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type DB = ReturnType<typeof getDb>;

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export { schema };

/** Drizzle wraps the D1 error, so the constraint message sits on `cause`. */
export function isUniqueViolation(e: unknown): boolean {
  for (let err = e; err; err = (err as { cause?: unknown }).cause) if (String(err).includes("UNIQUE constraint failed")) return true;
  return false;
}
