import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ApiError, api, errorMessage } from "../lib/api";
import { useHud } from "../ui/Feedback";
import { useTenant } from "./context";

export function useTenantQuery<T>(key: QueryKey, path: string, enabled = true) {
  const t = useTenant();
  return useQuery({ queryKey: [t.id, ...(key as unknown[])], queryFn: ({ signal }) => api.get<T>(`${t.base}${path}`, signal), enabled });
}

/**
 * POST/PATCH against the tenant API, then refresh everything for this tenant: one action usually
 * changes several screens (an order, Today, payments), and the data is small.
 */
export function useTenantAction<I = unknown, O = unknown>(
  method: "post" | "patch" | "put" | "del",
  path: string | ((input: I) => string),
  success?: string,
  opts: { silentOffline?: boolean } = {},
) {
  const t = useTenant();
  const qc = useQueryClient();
  const hud = useHud();
  return useMutation({
    mutationFn: (input: I) => {
      const p = `${t.base}${typeof path === "function" ? path(input) : path}`;
      const bodyOf = (input as { body?: unknown })?.body ?? input;
      if (method === "del") return api.del<O>(p);
      return api[method]<O>(p, bodyOf as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [t.id] });
      if (success) hud(success);
    },
    onError: (e) => {
      if (opts.silentOffline && e instanceof ApiError && e.status === 0) return;
      hud(errorMessage(e), "error");
    },
  });
}
