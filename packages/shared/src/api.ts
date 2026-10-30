import { z } from "zod";
import { supportedCurrencies } from "./money";
import { normalizePhone } from "./phone";

export const phoneSchema = z
  .string()
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: "custom", message: "Nomor WhatsApp tidak valid" });
    return p ?? "";
  });

const money = z.number().int().min(0).max(1_000_000_000_000);

export const checkoutSchema = z
  .object({
    tripId: z.string().min(1),
    customer: z.object({
      name: z.string().trim().min(2, "Nama minimal 2 huruf").max(80),
      phone: phoneSchema,
      email: z.email().optional().or(z.literal("")),
    }),
    address: z
      .object({
        recipient: z.string().trim().min(2).max(80),
        phone: phoneSchema,
        line: z.string().trim().min(5).max(300),
        city: z.string().trim().min(2).max(80),
        province: z.string().trim().max(80).optional(),
        postalCode: z.string().trim().max(10).optional(),
      })
      .optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          variant: z.string().max(80).optional(),
          qty: z.number().int().min(1).max(99),
          onUnavailable: z.enum(["refund", "substitute", "ask"]).default("refund"),
          maxPriceMinor: money.optional(),
          note: z.string().max(300).optional(),
        }),
      )
      .max(50)
      .default([]),
    requests: z
      .array(
        z.object({
          title: z.string().trim().min(2).max(120),
          link: z.url({ protocol: /^https?$/ }).max(500).optional().or(z.literal("")),
          note: z.string().max(300).optional(),
          qty: z.number().int().min(1).max(99),
          maxPriceMinor: money.optional(),
        }),
      )
      .max(20)
      .default([]),
    notes: z.string().max(500).optional(),
    holdForCombine: z.boolean().default(false),
    idempotencyKey: z.string().min(8).max(64),
    turnstileToken: z.string().optional(),
  })
  .refine((v) => v.items.length + v.requests.length > 0, "Keranjang masih kosong");
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const tripSchema = z.object({
  title: z.string().trim().min(3).max(80),
  country: z.string().trim().min(2).max(40),
  currency: z.enum(supportedCurrencies as [string, ...string[]]),
  kursMicro: z.number().int().positive(),
  kursLock: z.enum(["confirm", "settle"]).default("confirm"),
  rounding: z.union([z.literal(1), z.literal(100), z.literal(500), z.literal(1000)]).default(1000),
  defaultFee: money.default(0),
  dpPercent: z.number().int().min(0).max(100),
  closesAt: z.number().int(),
  etaAt: z.number().int().optional().nullable(),
  mode: z.enum(["hand_carry", "cargo", "mixed"]).default("cargo"),
  note: z.string().max(1000).optional().nullable(),
  cargoRatePerKg: money.optional().nullable(),
  cargoRoundG: z.union([z.literal(100), z.literal(500), z.literal(1000)]).optional(),
  cargoMinIdr: money.optional(),
  actualKursMicro: z.number().int().positive().optional().nullable(),
});
export type TripInput = z.input<typeof tripSchema>;

/** zod's .partial() still fills .default() values, which would silently reset fields on PATCH. */
export const tripPatchSchema = tripSchema
  .extend({
    kursLock: z.enum(["confirm", "settle"]),
    rounding: z.union([z.literal(1), z.literal(100), z.literal(500), z.literal(1000)]),
    defaultFee: money,
    mode: z.enum(["hand_carry", "cargo", "mixed"]),
    status: z.enum(["draft", "open", "closed", "done"]),
  })
  .partial();

export const productSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(1000).optional().nullable(),
  priceMinor: money,
  fee: money.default(0),
  estWeightG: z.number().int().min(0).max(100_000).optional().nullable(),
  quota: z.number().int().min(0).max(100_000).optional().nullable(),
  variants: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  photoKey: z.string().max(200).optional().nullable(),
  status: z.enum(["active", "hidden", "sold_out"]).default("active"),
});
export type ProductInput = z.input<typeof productSchema>;

export const productPatchSchema = productSchema
  .extend({ fee: money, variants: z.array(z.string().trim().min(1).max(40)).max(30), status: z.enum(["active", "hidden", "sold_out"]) })
  .partial();

export const decideItemSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("obtained"), actualPriceMinor: money.optional(), photoKey: z.string().optional(), receiptKey: z.string().optional() }),
  z.object({
    result: z.literal("partial"),
    qtyObtained: z.number().int().min(1),
    actualPriceMinor: money.optional(),
    photoKey: z.string().optional(),
    receiptKey: z.string().optional(),
  }),
  z.object({ result: z.literal("unavailable"), note: z.string().max(300).optional() }),
  z.object({
    result: z.literal("approval"),
    actualPriceMinor: money.optional(),
    note: z.string().trim().min(3).max(300),
    photoKey: z.string().optional(),
  }),
]);
export type DecideItemInput = z.input<typeof decideItemSchema>;

export const shipmentStatusSchema = z.object({
  status: z.enum(["preparing", "handed_to_forwarder", "departed", "in_transit", "arrived_id", "customs", "customs_cleared", "at_seller", "delayed", "held_by_customs"]),
  message: z.string().max(300).optional(),
  etaAt: z.number().int().optional().nullable(),
});

export const onboardingSchema = z.object({
  name: z.string().trim().min(3).max(60),
  slug: z.string(),
  waNumber: phoneSchema,
  bank: z
    .object({ bank: z.string().trim().min(2).max(40), number: z.string().trim().min(4).max(30), holder: z.string().trim().min(2).max(80) })
    .optional(),
  dpPercent: z.number().int().min(0).max(100).default(50),
  settleDays: z.number().int().min(1).max(30).default(3),
});
export type OnboardingInput = z.input<typeof onboardingSchema>;

export const parcelSchema = z.object({
  customerId: z.string().min(1),
  weightG: z.number().int().min(0).max(1_000_000),
  lengthCm: z.number().int().min(1).max(500).optional().nullable(),
  widthCm: z.number().int().min(1).max(500).optional().nullable(),
  heightCm: z.number().int().min(1).max(500).optional().nullable(),
});
export type ParcelInput = z.input<typeof parcelSchema>;

/** Push services browsers actually use; the server POSTs to this URL, so anything else is refused. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
export const pushEndpointSchema = z.url({ protocol: /^https$/, hostname: PUSH_HOSTS }).max(1000);
