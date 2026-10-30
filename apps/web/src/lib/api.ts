export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; headers?: Record<string, string>; form?: FormData; signal?: AbortSignal };

export async function request<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin", signal: opts.signal });
  } catch {
    throw new ApiError(0, "offline", "Tidak ada koneksi. Periksa internetmu lalu coba lagi.");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const d = data as { error?: string; message?: string; details?: unknown } | null;
    throw new ApiError(res.status, d?.error ?? "error", d?.message ?? (res.status === 429 ? "Terlalu banyak permintaan, coba lagi sebentar." : "Terjadi kesalahan. Coba lagi."), d?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>(path, { method: "POST", body: body ?? {}, headers }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  form: <T>(path: string, form: FormData, headers?: Record<string, string>) => request<T>(path, { method: "POST", form, headers }),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Terjadi kesalahan");
