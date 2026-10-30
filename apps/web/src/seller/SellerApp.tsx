import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { api } from "../lib/api";
import { flush } from "../lib/outbox";
import { registerSw } from "../lib/push";
import { REGULAR, useMediaQuery } from "../lib/useMediaQuery";
import { match, navigate, useLocation } from "../lib/router";
import type { Me } from "../lib/types";
import { AppShell } from "../ui/AppShell";
import { ErrorState, HudProvider, PageSpinner } from "../ui/Feedback";
import { Wordmark } from "../ui/Logo";
import { TenantContext, rememberTenant, rememberedTenant } from "./context";
import { KeyboardShortcuts } from "./CommandPalette";
import { Login } from "./Login";
import { activeNav, navFor } from "./nav";
import { Onboarding } from "./Onboarding";
import { SidebarToggleContext } from "./Screen";
import { StoreSwitcher } from "./StoreSwitcher";
import { Customers, CustomerDetail } from "./screens/Customers";
import { More } from "./screens/More";
import { Orders } from "./screens/Orders";
import { Admin } from "./screens/Admin";
import { Billing } from "./screens/Billing";
import { Payments } from "./screens/Payments";
import { Reports, TripReportScreen } from "./screens/Reports";
import { AcceptInvite, Team } from "./screens/Team";
import { Settings } from "./screens/Settings";
import { ShipmentDetail, Shipments } from "./screens/Shipments";
import { Shopping } from "./screens/Shopping";
import { Today } from "./screens/Today";
import { TripDetail, Trips } from "./screens/Trips";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

export default function SellerApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <HudProvider>
        <Gate />
      </HudProvider>
    </QueryClientProvider>
  );
}

function Gate() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });

  if (me.isPending) return <PageSpinner />;
  if (me.isError || !me.data)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center px-[var(--gutter)]">
        <div className="w-full">
          <ErrorState message="Gagal memuat. Periksa koneksi internetmu." onRetry={() => me.refetch()} />
        </div>
      </main>
    );
  if (!me.data.user) return <Login me={me.data} onDone={refresh} />;
  const invite = location.pathname === "/undangan" ? new URLSearchParams(location.search).get("token") : null;
  if (invite)
    return (
      <AcceptInvite
        token={invite}
        onDone={(id) => {
          rememberTenant(id);
          navigate("/", { replace: true });
          refresh();
        }}
      />
    );
  if (!me.data.tenants.length || new URLSearchParams(location.search).has("toko-baru"))
    return (
      <Onboarding
        onDone={(id) => {
          rememberTenant(id);
          refresh();
          navigate("/trip?baru=1", { replace: true });
        }}
      />
    );
  return <Shell me={me.data} />;
}

function Shell({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const regular = useMediaQuery(REGULAR);
  const tenant = useMemo(() => me.tenants.find((t) => t.id === rememberedTenant()) ?? me.tenants[0]!, [me]);
  const nav = useMemo(() => navFor(tenant), [tenant]);

  const qc = useQueryClient();
  useEffect(() => {
    void registerSw();
    const sync = async () => {
      if (!navigator.onLine) return;
      const r = await flush().catch(() => null);
      if (r?.sent) qc.invalidateQueries();
    };
    void sync();
    window.addEventListener("online", sync);
    const timer = setInterval(sync, 30_000);
    return () => {
      window.removeEventListener("online", sync);
      clearInterval(timer);
    };
  }, [qc]);

  useEffect(() => {
    document.documentElement.style.setProperty("--tint", tenant.tintColor ?? "");
    if (!tenant.tintColor) document.documentElement.style.removeProperty("--tint");
  }, [tenant.tintColor]);

  return (
    <TenantContext.Provider value={tenant}>
      <AppShell
        items={regular ? nav.filter((i) => i.section !== "__tab-only") : nav}
        active={activeNav(pathname)}
        onNavigate={(id) => navigate(nav.find((n) => n.id === id)!.path, { replace: true, direction: "none" })}
        sidebarHeader={
          <div className="space-y-3">
            <Wordmark />
            <StoreSwitcher me={me} current={tenant} />
          </div>
        }
      >
        {({ sidebarToggle }) => (
          <SidebarToggleContext.Provider value={sidebarToggle}>
            <KeyboardShortcuts />
            <Routes pathname={pathname} me={me} />
          </SidebarToggleContext.Provider>
        )}
      </AppShell>
    </TenantContext.Provider>
  );
}

function Routes({ pathname, me }: { pathname: string; me: Me }) {
  let p: Record<string, string> | null;
  if (pathname === "/") return <Today />;
  if (pathname === "/pesanan") return <Orders />;
  if ((p = match("/pesanan/:id", pathname))) return <Orders selectedId={p.id!} />;
  if (pathname === "/trip") return <Trips />;
  if ((p = match("/trip/:id", pathname))) return <TripDetail id={p.id!} />;
  if (pathname === "/belanja") return <Shopping />;
  if (pathname === "/pembayaran") return <Payments />;
  if (pathname === "/pengiriman") return <Shipments />;
  if ((p = match("/pengiriman/:id", pathname))) return <ShipmentDetail id={p.id!} />;
  if (pathname === "/pelanggan") return <Customers />;
  if ((p = match("/pelanggan/:id", pathname))) return <CustomerDetail id={p.id!} />;
  if (pathname === "/pengaturan") return <Settings me={me} />;
  if (pathname === "/lainnya") return <More me={me} />;
  if (pathname === "/tim") return <Team />;
  if (pathname === "/paket") return <Billing />;
  if (pathname === "/admin" && me.platformAdmin) return <Admin />;
  if (pathname === "/laporan") return <Reports />;
  if ((p = match("/laporan/:id", pathname))) return <TripReportScreen id={p.id!} />;
  return <Today />;
}
