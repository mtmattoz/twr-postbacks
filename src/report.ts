import { Router } from "express";
import { z } from "zod";
import { pool } from "./db";

export const reportRouter = Router();

const querySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

const SALES_CTE = `
  WITH approved AS (
    SELECT DISTINCT ON (transaction_id)
      transaction_id, product_id, product_name, amount_cents,
      utm_source, utm_campaign, occurred_at
    FROM sale_events
    WHERE event_type = 'sale.approved'
    ORDER BY transaction_id, occurred_at
  ),
  sales AS (
    SELECT a.*,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM sale_events e
          WHERE e.transaction_id = a.transaction_id AND e.event_type = 'sale.chargeback'
        ) THEN 'chargeback'
        WHEN EXISTS (
          SELECT 1 FROM sale_events e
          WHERE e.transaction_id = a.transaction_id AND e.event_type = 'sale.refunded'
        ) THEN 'refunded'
        ELSE 'approved'
      END AS status
    FROM approved a
    WHERE ($1::date IS NULL OR a.occurred_at >= $1::date)
      AND ($2::date IS NULL OR a.occurred_at < $2::date + 1)
  )
`;

reportRouter.get("/report", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ error: "Use as datas no formato AAAA-MM-DD" });
    return;
  }

  const { from, to } = parsed.data;
  const params = [from ?? null, to ?? null];

  const [summaryResult, productResult, campaignResult] = await Promise.all([
    pool.query(
      `${SALES_CTE}
       SELECT
         COUNT(*) AS total_sales,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved_sales,
         COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_sales,
         COUNT(*) FILTER (WHERE status = 'chargeback') AS chargeback_sales,
         COALESCE(SUM(amount_cents), 0) AS gross_cents,
         COALESCE(SUM(amount_cents) FILTER (WHERE status = 'refunded'), 0) AS refunded_cents,
         COALESCE(SUM(amount_cents) FILTER (WHERE status = 'chargeback'), 0) AS chargeback_cents,
         COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0) AS net_cents
       FROM sales`,
      params
    ),
    pool.query(
      `${SALES_CTE}
       SELECT
         product_id,
         MAX(product_name) AS product_name,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved_sales,
         COUNT(*) FILTER (WHERE status <> 'approved') AS lost_sales,
         COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0) AS net_cents
       FROM sales
       GROUP BY product_id
       ORDER BY net_cents DESC`,
      params
    ),
    pool.query(
      `${SALES_CTE}
       SELECT
         utm_source,
         utm_campaign,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved_sales,
         COUNT(*) FILTER (WHERE status <> 'approved') AS lost_sales,
         COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0) AS net_cents
       FROM sales
       GROUP BY utm_source, utm_campaign
       ORDER BY net_cents DESC`,
      params
    ),
  ]);

  const s = summaryResult.rows[0];
  const approvedSales = Number(s.approved_sales);
  const netCents = Number(s.net_cents);

  res.json({
    period: { from: from ?? null, to: to ?? null },
    currency: "BRL",
    summary: {
      total_sales: Number(s.total_sales),
      approved_sales: approvedSales,
      refunded_sales: Number(s.refunded_sales),
      chargeback_sales: Number(s.chargeback_sales),
      gross_revenue_cents: Number(s.gross_cents),
      refunded_cents: Number(s.refunded_cents),
      chargeback_cents: Number(s.chargeback_cents),
      net_revenue_cents: netCents,
      average_ticket_cents: approvedSales > 0 ? Math.round(netCents / approvedSales) : 0,
    },
    by_product: productResult.rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      approved_sales: Number(r.approved_sales),
      lost_sales: Number(r.lost_sales),
      net_revenue_cents: Number(r.net_cents),
    })),
    by_campaign: campaignResult.rows.map((r) => ({
      utm_source: r.utm_source,
      utm_campaign: r.utm_campaign,
      approved_sales: Number(r.approved_sales),
      lost_sales: Number(r.lost_sales),
      net_revenue_cents: Number(r.net_cents),
    })),
  });
});