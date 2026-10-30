import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { useEffect } from "react";
import { ApiError, api, errorMessage } from "../lib/api";
import { back, match, navigate, useLocation } from "../lib/router";
import { media } from "../lib/types";
import { Account } from "../store/Account";
import { Catalog, ChatSeller } from "../store/Catalog";
import type { StoreData } from "../store/data";
import { InvoicePage, Track } from "../store/Track";
import { ErrorState, HudProvider, PageSpinner } from "../ui/Feedback";
import { NavBackButton, NavBar } from "../ui/NavBar";
import NotFound from "./NotFound";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

export default function Store({ slug }: { slug: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <HudProvider>
        <StoreRoot slug={slug} />
      </HudProvider>
    </QueryClientProvider>
  );
}

function StoreRoot({ slug }: { slug: string }) {
  const { pathname } = useLocation();
  const q = useQuery({ queryKey: ["store"], queryFn: ({ signal }) => api.get<StoreData>("/api/store", signal) });

  useEffect(() => {
    const tint = q.data?.store.tintColor;
    if (tint) document.documentElement.style.setProperty("--tint", tint);
    if (q.data) document.title = q.data.store.name;
  }, [q.data]);

  if (q.isPending) return <PageSpinner />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFound />;
    return (
      <div className="mx-auto max-w-[560px] p-6 pt-20">
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </div>
    );
  }

  const data = q.data;
  let p: Record<string, string> | null;
  let title = data.store.name;
  let body = <Catalog data={data} />;
  let isSub = false;
  if ((p = match("/o/:code/tagihan/:id", pathname))) {
    title = "Tagihan";
    body = <InvoicePage code={p.code!} id={p.id!} />;
    isSub = true;
  } else if (pathname === "/akun") {
    title = "Pesananku";
    body = <Account />;
    isSub = true;
  } else if ((p = match("/o/:code", pathname))) {
    title = "Pesanan";
    body = <Track key={p.code} code={p.code!} />;
    isSub = true;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[1100px] pb-[calc(var(--safe-bottom)+96px)]">
      <NavBar
        className="no-print"
        title={title}
        largeTitle={!isSub}
        leading={
          isSub ? (
            <NavBackButton label={data.store.name} onClick={() => back("/")} />
          ) : data.store.logoKey ? (
            <img src={media(data.store.logoKey)!} alt="" className="size-10 rounded-full object-cover" />
          ) : null
        }
        trailing={
          !isSub && (
            <div className="flex gap-2">
              <button type="button" onClick={() => navigate("/akun")} className="glass inline-flex h-11 items-center gap-1.5 rounded-full pl-3 pr-4 text-subhead font-semibold text-tint-text">
                <PackageSearch className="size-5" />
                Pesananku
              </button>
              {!data.store.demo && <ChatSeller wa={data.store.waNumber} />}
            </div>
          )
        }
      />
      <main className="px-[max(var(--gutter),var(--safe-left))]" data-slug={slug}>
        {body}
      </main>
    </div>
  );
}
