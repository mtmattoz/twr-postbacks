import { z } from "zod";

export const saleEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.enum(["sale.approved", "sale.refunded", "sale.chargeback"]),
  occurred_at: z.iso.datetime({ offset: true }),
  transaction_id: z.string().min(1),
  product: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  amount_cents: z.number().int().nonnegative(),
  currency: z.literal("BRL"),
  tracking: z
    .object({
      utm_source: z.string().optional(),
      utm_campaign: z.string().optional(),
    })
    .optional(),
});

export type SaleEvent = z.infer<typeof saleEventSchema>;