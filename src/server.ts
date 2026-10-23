import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import { initDb } from "./db";
import { webhooksRouter } from "./webhooks";

const app = express();

app.use(express.json());
app.use(webhooksRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ error: "JSON malformado" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
};

app.use(errorHandler);

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