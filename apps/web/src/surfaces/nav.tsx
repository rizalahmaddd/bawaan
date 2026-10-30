import { BarChart3, CalendarCheck, ClipboardList, CreditCard, Ellipsis, Plane, Settings, ShoppingBag, Truck, Users } from "lucide-react";
import type { NavItem } from "../ui/AppShell";

export const sellerNav: NavItem[] = [
  { id: "today", label: "Hari ini", icon: <CalendarCheck />, inTabBar: true },
  { id: "orders", label: "Pesanan", icon: <ClipboardList />, inTabBar: true },
  { id: "shopping", label: "Belanja", icon: <ShoppingBag />, inTabBar: true },
  { id: "customers", label: "Pelanggan", icon: <Users />, inTabBar: true },
  { id: "trips", label: "Trip", icon: <Plane />, section: "Operasional" },
  { id: "payments", label: "Pembayaran", icon: <CreditCard />, section: "Operasional" },
  { id: "shipments", label: "Pengiriman", icon: <Truck />, section: "Operasional" },
  { id: "reports", label: "Laporan", icon: <BarChart3 />, section: "Toko" },
  { id: "settings", label: "Pengaturan", icon: <Settings />, section: "Toko" },
  { id: "more", label: "Lainnya", icon: <Ellipsis />, inTabBar: true, section: "__tab-only" },
];

/** "Lainnya" only exists as a tab on phones; the sidebar lists everything directly. */
export const sidebarNav = sellerNav.filter((i) => i.section !== "__tab-only");
