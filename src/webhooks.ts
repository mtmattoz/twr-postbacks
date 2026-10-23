import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "./db";
import { saleEventSchema } from "./schema";

export const webhooksRouter = Router();

function isValidToken(received: string | undefined): boolean {
  const expected = process.env.WEBHOOK_SECRET;

  if (!expected || !received) {
    return false;
  }

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

webhooksRouter.post("/webhooks/sales", async (req, res) => {
  // 1. Confere o token
  if (!isValidToken(req.header("x-webhook-token"))) {
    res.status(401).json({ error: "Token inválido ou ausente" });
    return;
  }

  // 2. Valida o JSON
  const result = saleEventSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      error: "Payload inválido",
      details: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const event = result.data;

  // 3. Salva no banco (ignorando duplicatas)
  const insert = await pool.query(
    `INSERT INTO sale_events (
       event_id, event_type, transaction_id, product_id, product_name,
       amount_cents, currency, utm_source, utm_campaign, occurred_at, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      event.event_id,
      event.event_type,
      event.transaction_id,
      event.product.id,
      event.product.name,
      event.amount_cents,
      event.currency,
      event.tracking?.utm_source ?? null,
      event.tracking?.utm_campaign ?? null,
      event.occurred_at,
      JSON.stringify(req.body),
    ]
  );

  if (insert.rowCount === 0) {
    res.status(200).json({ status: "duplicate", event_id: event.event_id });
    return;
  }

  res.status(201).json({ status: "created", event_id: event.event_id });
});