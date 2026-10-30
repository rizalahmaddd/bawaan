import { useSyncExternalStore } from "react";
import { ApiError, api } from "./api";

/**
 * Decisions taken in Shopping Mode while abroad without signal. Each entry keeps its own id as the
 * Idempotency-Key, so replaying after a flaky response can't apply it twice on the server.
 */
export type OutboxEntry = {
  id: string;
  tenantBase: string;
  itemId: string;
  title: string;
  body: Record<string, unknown>;
  photo?: Blob;
  receipt?: Blob;
  clientAt: number;
  error?: string;
};

const DB = "bawaan-outbox";
const STORE = "entries";
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let snapshot: OutboxEntry[] = [];
const listeners = new Set<() => void>();

async function refresh() {
  try {
    snapshot = (await tx<OutboxEntry[]>("readonly", (s) => s.getAll())).sort((a, b) => a.clientAt - b.clientAt);
  } catch {
    snapshot = [];
  }
  listeners.forEach((l) => l());
}

export function useOutbox(tenantBase: string) {
  const all = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (listeners.size === 1) void refresh();
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
  return all.filter((e) => e.tenantBase === tenantBase);
}

export async function enqueue(entry: Omit<OutboxEntry, "id" | "clientAt">) {
  // One pending decision per item: a newer tap replaces the older one before it ever leaves the phone.
  for (const old of snapshot.filter((e) => e.itemId === entry.itemId)) await tx("readwrite", (s) => s.delete(old.id));
  await tx("readwrite", (s) => s.put({ ...entry, id: crypto.randomUUID(), clientAt: Date.now() }));
  await refresh();
}

export async function discard(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  await refresh();
}

async function upload(base: string, blob: Blob, kind: string) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new File([blob], `${kind}.jpg`, { type: blob.type || "image/jpeg" }));
  return (await api.form<{ key: string }>(`${base}/uploads`, form)).key;
}

let flushing: Promise<{ sent: number; failed: number }> | null = null;

/** Sends what it can in order. Stops at the first network failure; a rejected entry is kept with its error for the seller to see. */
export function flush(): Promise<{ sent: number; failed: number }> {
  flushing ??= (async () => {
    await refresh();
    let sent = 0;
    let failed = 0;
    for (const e of snapshot) {
      if (e.error) continue;
      try {
        const body = { ...e.body };
        if (e.photo) body.photoKey = await upload(e.tenantBase, e.photo, "item");
        if (e.receipt) body.receiptKey = await upload(e.tenantBase, e.receipt, "receipt");
        await api.post(`${e.tenantBase}/items/${e.itemId}/decide`, body, { "idempotency-key": e.id, "x-client-at": String(e.clientAt) });
        await tx("readwrite", (s) => s.delete(e.id));
        sent++;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 0 || err.status >= 500 || err.status === 429)) break;
        failed++;
        await tx("readwrite", (s) => s.put({ ...e, error: err instanceof Error ? err.message : "Gagal dikirim" }));
      }
    }
    await refresh();
    return { sent, failed };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
