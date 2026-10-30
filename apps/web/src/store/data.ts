import { useSyncExternalStore } from "react";
import type { Bank } from "../lib/types";

export type StoreProduct = {
  id: string;
  title: string;
  description: string | null;
  priceMinor: number;
  fee: number;
  photoKey: string | null;
  variants: string[];
  left: number | null;
  status: "active" | "sold_out";
};

export type StoreTrip = {
  id: string;
  title: string;
  country: string;
  currency: string;
  kursMicro: number;
  rounding: number;
  dpPercent: number;
  kind: "po" | "ready";
  closesAt: number;
  etaAt: number | null;
  note: string | null;
  products: StoreProduct[];
};

export type StoreData = {
  store: { name: string; slug: string; waNumber: string; tintColor: string | null; logoKey: string | null; policyText: string; paused: boolean; demo?: boolean; isNew: boolean; branding: boolean };
  banks: Bank[];
  trips: StoreTrip[];
  vapidPublicKey: string | null;
  turnstileSiteKey: string | null;
};

export type CartLine = { key: string; productId: string; variant?: string; qty: number; onUnavailable: "refund" | "substitute" | "ask"; note?: string };
export type RequestLine = { key: string; title: string; link?: string; note?: string; qty: number; maxPriceMinor?: number };
export type Cart = { lines: CartLine[]; requests: RequestLine[] };

const EMPTY: Cart = { lines: [], requests: [] };
const listeners = new Set<() => void>();
const cache = new Map<string, Cart>();

function read(tripId: string): Cart {
  if (!cache.has(tripId)) {
    try {
      cache.set(tripId, JSON.parse(localStorage.getItem(`bawaan.cart.${tripId}`) ?? "null") ?? EMPTY);
    } catch {
      cache.set(tripId, EMPTY);
    }
  }
  return cache.get(tripId)!;
}

export function writeCart(tripId: string, cart: Cart) {
  cache.set(tripId, cart);
  try {
    if (cart.lines.length || cart.requests.length) localStorage.setItem(`bawaan.cart.${tripId}`, JSON.stringify(cart));
    else localStorage.removeItem(`bawaan.cart.${tripId}`);
  } catch {}
  listeners.forEach((l) => l());
}

export function useCart(tripId: string) {
  const cart = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(tripId),
  );
  return [cart, (c: Cart) => writeCart(tripId, c)] as const;
}

export const cartCount = (c: Cart) => c.lines.reduce((s, l) => s + l.qty, 0) + c.requests.reduce((s, r) => s + r.qty, 0);

const tokenKey = (code: string) => `bawaan.order.${code.toUpperCase()}`;
export const saveOrderToken = (code: string, token: string) => {
  try {
    localStorage.setItem(tokenKey(code), token);
    const known = new Set(JSON.parse(localStorage.getItem("bawaan.orders") ?? "[]") as string[]);
    known.add(code.toUpperCase());
    localStorage.setItem("bawaan.orders", JSON.stringify([...known]));
  } catch {}
};
export const orderToken = (code: string) => {
  try {
    return localStorage.getItem(tokenKey(code));
  } catch {
    return null;
  }
};
export const knownOrders = (): string[] => {
  try {
    return (JSON.parse(localStorage.getItem("bawaan.orders") ?? "[]") as string[]).filter((c) => orderToken(c));
  } catch {
    return [];
  }
};
