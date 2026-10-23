import "dotenv/config";
import express from "express";
import { initDb } from "./db";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  await initDb();

  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Falha ao iniciar o servidor:", error);
  process.exit(1);
});