import { can } from "@bawaan/shared";
import { BarChart3, CalendarCheck, ClipboardList, CreditCard, Ellipsis, Plane, Settings, ShoppingBag, Truck, Users } from "lucide-react";
import type { TenantCtx } from "./context";
import type { NavItem } from "../ui/AppShell";

export type SellerNavItem = NavItem & { path: string };

export const sellerNav: SellerNavItem[] = [
  { id: "today", path: "/", label: "Hari ini", icon: <CalendarCheck />, inTabBar: true },
  { id: "orders", path: "/pesanan", label: "Pesanan", icon: <ClipboardList />, inTabBar: true },
  { id: "shopping", path: "/belanja", label: "Belanja", icon: <ShoppingBag />, inTabBar: true },
  { id: "customers", path: "/pelanggan", label: "Pelanggan", icon: <Users />, inTabBar: true },
  { id: "trips", path: "/trip", label: "Trip & katalog", icon: <Plane />, section: "Operasional" },
  { id: "payments", path: "/pembayaran", label: "Pembayaran", icon: <CreditCard />, section: "Operasional" },
  { id: "shipments", path: "/pengiriman", label: "Pengiriman", icon: <Truck />, section: "Operasional" },
  { id: "reports", path: "/laporan", label: "Laporan", icon: <BarChart3 />, section: "Toko" },
  { id: "settings", path: "/pengaturan", label: "Pengaturan", icon: <Settings />, section: "Toko" },
  { id: "more", path: "/lainnya", label: "Lainnya", icon: <Ellipsis />, inTabBar: true, section: "__tab-only" },
];

export const sidebarNav = sellerNav.filter((i) => i.section !== "__tab-only");

/** Hides what the member can't open anyway, so staff don't land on a 403. */
export function navFor(t: Pick<TenantCtx, "role" | "grants">) {
  return sellerNav.filter((i) => i.id !== "reports" || can(t.role, t.grants, "reports"));
}

const settingsPages = ["/tim", "/paket", "/admin"];

export function activeNav(pathname: string) {
  if (settingsPages.includes(pathname)) return "settings";
  const hit = [...sellerNav].sort((a, b) => b.path.length - a.path.length).find((i) => (i.path === "/" ? pathname === "/" : pathname.startsWith(i.path)));
  return hit?.id ?? "today";
}
