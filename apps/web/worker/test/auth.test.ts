import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { safeReturn } from "../auth/routes";
import { sha256 } from "../lib/crypto";
import { APP, call } from "./helpers";

describe("sign-in hardening", () => {
  it("only returns to same-site paths", () => {
    expect(safeReturn("/pesanan?x=1")).toBe("/pesanan?x=1");
    for (const bad of ["//evil.example", "/\\evil.example", "/\\/evil.example", "https://evil.example", "/ok\nLocation: x", undefined]) {
      expect(safeReturn(bad)).toBe("/");
    }
  });

  it("refuses a handoff code opened in a browser that didn't start the sign-in", async () => {
    const userId = "usr_handoff_test";
    await env.DB.prepare("insert into users (id, google_sub, email, name) values (?, ?, ?, ?)").bind(userId, "google:handoff", "h@example.com", "H").run();
    const insert = async (code: string, state: string) =>
      env.DB.prepare("insert into auth_handoffs (code_hash, user_id, return_to, target, expires_at) values (?, ?, '/', null, ?)").bind(await sha256(`${code}.${state}`), userId, Date.now() + 60_000).run();

    await insert("code-a", "state-a");
    const stolen = await call(`${APP}/api/auth/finish?code=code-a`);
    expect(stolen.status).toBe(302);
    expect(stolen.headers.get("location")).toBe("/?login=gagal");
    expect(stolen.headers.get("set-cookie") ?? "").not.toContain("sid=");

    await insert("code-b", "state-b");
    const own = await call(`${APP}/api/auth/finish?code=code-b`, { cookie: "oauth_bind=state-b" });
    expect(own.status).toBe(302);
    expect(own.headers.get("set-cookie")).toMatch(/(^|, )sid=/);
  });
});
