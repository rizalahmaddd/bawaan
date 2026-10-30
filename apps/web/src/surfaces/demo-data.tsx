import { CheckCircle2, Clock, HelpCircle, Plane, Search, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "../ui/Pill";

export type ItemStatus = "hunting" | "obtained" | "partial" | "unavailable" | "approval" | "in_cargo";

export const itemStatus: Record<ItemStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  hunting: { label: "Sedang dicari", tone: "blue", icon: <Search /> },
  obtained: { label: "Dapat", tone: "green", icon: <CheckCircle2 /> },
  partial: { label: "Dapat sebagian", tone: "indigo", icon: <CheckCircle2 /> },
  unavailable: { label: "Tidak dapat", tone: "red", icon: <XCircle /> },
  approval: { label: "Butuh persetujuanmu", tone: "orange", icon: <HelpCircle /> },
  in_cargo: { label: "Di perjalanan", tone: "blue", icon: <Plane /> },
};

export const waitingPill = { label: "Menunggu pelunasan", tone: "orange" as Tone, icon: <Clock /> };

export type DemoItem = { title: string; variant: string; qty: number; price: number; status: ItemStatus; hue: number };
export type DemoOrder = { code: string; customer: string; trip: string; total: number; due: number; items: DemoItem[] };

export const demoOrders: DemoOrder[] = [
  {
    code: "JPN-2611-K7QD",
    customer: "Nadia Putri",
    trip: "Jastip Jepang Nov 2026",
    total: 1_486_000,
    due: 743_000,
    items: [
      { title: "Tokyo Banana 8 pcs", variant: "Original", qty: 2, price: 168_000, status: "obtained", hue: 45 },
      { title: "Canmake Marshmallow Powder", variant: "MO", qty: 1, price: 214_000, status: "approval", hue: 330 },
      { title: "Uniqlo Airism Tee", variant: "M · Putih", qty: 3, price: 236_000, status: "partial", hue: 210 },
      { title: "Pokémon Center Plush", variant: "Pikachu", qty: 1, price: 464_000, status: "unavailable", hue: 55 },
    ],
  },
  {
    code: "JPN-2611-M2ZA",
    customer: "Rina Amalia",
    trip: "Jastip Jepang Nov 2026",
    total: 912_000,
    due: 0,
    items: [
      { title: "Shiseido Anessa 60 ml", variant: "Gold", qty: 2, price: 312_000, status: "in_cargo", hue: 48 },
      { title: "Royce Nama Chocolate", variant: "Matcha", qty: 1, price: 288_000, status: "in_cargo", hue: 120 },
    ],
  },
  {
    code: "KOR-2611-P9TB",
    customer: "Dewi Lestari",
    trip: "Jastip Korea Des 2026",
    total: 645_000,
    due: 322_500,
    items: [{ title: "Gentle Monster Lilit", variant: "01", qty: 1, price: 645_000, status: "hunting", hue: 0 }],
  },
];
