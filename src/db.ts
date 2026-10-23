import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("A variável DATABASE_URL não foi definida no .env");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sale_events (
      id              BIGSERIAL PRIMARY KEY,
      event_id        TEXT NOT NULL UNIQUE,
      event_type      TEXT NOT NULL,
      transaction_id  TEXT NOT NULL,
      product_id      TEXT NOT NULL,
      product_name    TEXT NOT NULL,
      amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency        TEXT NOT NULL,
      utm_source      TEXT,
      utm_campaign    TEXT,
      occurred_at     TIMESTAMPTZ NOT NULL,
      received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      raw_payload     JSONB NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sale_events_transaction_id
    ON sale_events (transaction_id);
  `);

  console.log("Banco de dados pronto");
}