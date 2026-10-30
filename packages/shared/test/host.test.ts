import { describe, expect, it } from "vitest";
import { resolveSurface } from "../src";

const roots = ["bawaan.my.id", "localhost"];

describe("resolveSurface", () => {
  it.each([
    ["bawaan.my.id", { kind: "landing" }],
    ["BAWAAN.MY.ID.", { kind: "landing" }],
    ["www.bawaan.my.id", { kind: "redirect", to: "bawaan.my.id" }],
    ["app.bawaan.my.id", { kind: "app" }],
    ["accounts.bawaan.my.id", { kind: "accounts" }],
    ["cdn.bawaan.my.id", { kind: "cdn" }],
    ["demo.bawaan.my.id", { kind: "store", slug: "demo" }],
    ["toko-ayu.localhost", { kind: "store", slug: "toko-ayu" }],
    ["localhost", { kind: "landing" }],
    ["a.b.bawaan.my.id", { kind: "not-found", reason: "nested" }],
    ["-x-.bawaan.my.id", { kind: "not-found", reason: "invalid-slug" }],
    ["evil.com", { kind: "not-found", reason: "unknown-host" }],
    ["notbawaan.my.id", { kind: "not-found", reason: "unknown-host" }],
  ])("%s", (host, expected) => {
    expect(resolveSurface(host, roots)).toEqual(expected);
  });
});
