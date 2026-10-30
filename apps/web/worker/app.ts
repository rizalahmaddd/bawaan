import type { Grants, Surface } from "@bawaan/shared";
import { Hono } from "hono";
import type { DB } from "./db";

export type SessionUser = { id: string; email: string; name: string; avatarUrl: string | null };
export type TenantCtx = { id: string; slug: string; name: string; role: "owner" | "admin" | "staff"; grants: Grants };

export type AppEnv = {
  Bindings: Env;
  Variables: { surface: Surface; db: DB; user: SessionUser; tenant: TenantCtx };
};

export const createRouter = () => new Hono<AppEnv>();
