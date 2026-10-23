# Receptor de Postbacks — Desafio TWR

Aplicação em TypeScript que recebe notificações de venda (webhooks/postbacks) enviadas por plataformas de checkout e devolve um relatório das vendas.

**URL pública:** https://twr-postbacks.onrender.com

> A aplicação está no plano gratuito do Render. Depois de ~15 minutos sem uso, a instância hiberna e a primeira requisição pode levar cerca de 50 segundos para responder.

## Stack

- Node.js 22 + TypeScript (modo `strict`)
- Express 5
- Zod (validação do payload)
- PostgreSQL gerenciado (Neon), acessado com `pg` e SQL puro
- Deploy no Render

## Rotas

| Método | Rota | Descrição |
------------------------------------------------------------
| `POST` | `/webhooks/sales` | Recebe um evento de venda |
| `GET` | `/report` | Relatório consolidado das vendas |
| `GET` | `/health` | Health check |

## Como chamar

### `POST /webhooks/sales`

Exige o header `X-Webhook-Token`. O token foi enviado no e-mail de entrega.

```bash
curl -X POST https://twr-postbacks.onrender.com/webhooks/sales \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: SEU_TOKEN" \
  -d '{
    "event_id": "evt_001",
    "event_type": "sale.approved",
    "occurred_at": "2026-10-23T14:30:00Z",
    "transaction_id": "TX-1001",
    "product": { "id": "curso-marketing", "name": "Curso de Marketing" },
    "amount_cents": 19700,
    "currency": "BRL",
    "tracking": { "utm_source": "facebook", "utm_campaign": "black-friday" }
  }'
```

**Campos**

| Campo | Tipo | Obrigatório | Observação |
---------------------------------------------------------------------------------
| `event_id` | string | sim | ID único da notificação, usado para idempotência |
| `event_type` | string | sim | `sale.approved`, `sale.refunded` ou `sale.chargeback` |
| `occurred_at` | string | sim | Data/hora ISO 8601 (`Z` ou com fuso, ex.: `-03:00`) |
| `transaction_id` | string | sim | ID da venda; vários eventos podem compartilhar o mesmo |
| `product.id` / `product.name` | string | sim | |
| `amount_cents` | inteiro ≥ 0 | sim | Valor em centavos (R$ 197,00 = `19700`) |
| `currency` | string | sim | Apenas `BRL` |
| `tracking.utm_source` / `tracking.utm_campaign` | string | não | Origem da venda |

**Respostas**

| Status | Quando |
|---|---|
| `201` | Evento novo registrado |
| `200` | Evento duplicado (mesmo `event_id`), ignorado sem erro |
| `400` | JSON malformado ou payload inválido (com o detalhe de cada campo) |
| `401` | Token ausente ou inválido |
| `500` | Erro interno (ex.: banco indisponível), sem expor detalhes |

### `GET /report`

```bash
curl https://twr-postbacks.onrender.com/report
```

Com filtro de período (datas `AAAA-MM-DD`, ambas opcionais e inclusivas, em UTC):

```bash
curl "https://twr-postbacks.onrender.com/report?from=2026-10-01&to=2026-10-31"
```

Exemplo de resposta (resumida):

```json
{
  "period": { "from": null, "to": null },
  "currency": "BRL",
  "summary": {
    "total_sales": 3,
    "approved_sales": 2,
    "refunded_sales": 1,
    "chargeback_sales": 0,
    "gross_revenue_cents": 44100,
    "refunded_cents": 19700,
    "chargeback_cents": 0,
    "net_revenue_cents": 24400,
    "average_ticket_cents": 12200
  },
  "by_product": [ ... ],
  "by_campaign": [ ... ]
}
```

- **Receita bruta:** soma de todas as vendas que foram aprovadas em algum momento.
- **Receita líquida:** apenas as vendas que continuam aprovadas (sem reembolso nem chargeback).
- **Ticket médio:** receita líquida ÷ vendas aprovadas.
- **`lost_sales`:** vendas reembolsadas ou com chargeback.
- O filtro de período considera a data da aprovação da venda.

## Premissas e decisões

**1. Formato próprio de payload.** O desafio não define o formato, então criei um formato normalizado, inspirado em plataformas como Hotmart e Kiwify. Em um cenário real, cada plataforma teria um adaptador que converte o payload dela para esse formato interno.

**2. Idempotência.** Plataformas entregam webhooks no modelo *at-least-once* e reenviam em caso de timeout ou erro, então a mesma notificação pode chegar mais de uma vez. A coluna `event_id` tem restrição `UNIQUE` e a inserção usa `ON CONFLICT (event_id) DO NOTHING`. Optei por isso em vez de "consultar e depois inserir" porque é uma operação atômica no banco, sem condição de corrida quando duas cópias chegam ao mesmo tempo. Uma duplicata responde `200`, para a plataforma parar de reenviar.

**3. Eventos fora de ordem.** Um reembolso pode chegar antes da aprovação. Por isso guardo todos os eventos como chegam (sem atualizar um "status da venda") e calculo o status final no momento do relatório, com a precedência: chargeback > reembolso > aprovada. O resultado é o mesmo independentemente da ordem de chegada.

**4. Autenticação.** O `POST` exige o header `X-Webhook-Token`, comparado com o segredo da variável de ambiente usando `crypto.timingSafeEqual` (comparação em tempo constante, que evita timing attacks). Se o segredo não estiver configurado, todas as requisições são recusadas.

**5. Dinheiro em centavos inteiros.** Evita os erros de arredondamento de ponto flutuante (`0.1 + 0.2 !== 0.3`). Aceito apenas `BRL`, porque somar moedas diferentes no mesmo total não faria sentido.

**6. Validação em duas camadas.** O Zod valida o payload e devolve erros claros por campo. O banco reforça as regras principais (`NOT NULL`, `CHECK (amount_cents >= 0)`).

**7. Tolerância a campos extras.** Campos desconhecidos são aceitos e ignorados, porque plataformas reais adicionam campos com frequência. O payload original completo fica guardado na coluna `raw_payload` (JSONB), para auditoria e investigação.

**8. Tratamento de erros.** JSON malformado responde `400` em JSON, sem stack trace. Erros inesperados respondem `500` com mensagem genérica (o detalhe fica só no log), e o `500` faz a plataforma reenviar, então nenhuma venda se perde se o banco cair temporariamente.

**9. Banco gerenciado.** Usei Postgres no Neon em vez de memória ou SQLite, porque o disco do plano gratuito do Render é momentaneo e os dados seriam perdidos a cada reinício. Banco e aplicação ficam na mesma região (US East – Ohio) para reduzir a latência. A conexão usa `sslmode=verify-full`.

**10. SQL puro em vez de ORM.** Deixa explícitas as partes centrais (a restrição `UNIQUE`, o `ON CONFLICT` e as agregações do relatório). A tabela é criada na inicialização com `CREATE TABLE IF NOT EXISTS`. Todas as queries são parametrizadas, o que evita SQL injection.

**11. Relatório público.** O `GET /report` não exige autenticação, para facilitar a avaliação. Em produção, ele ficaria protegido.

**12. Valor de reembolso e chargeback.** Considero que um reembolso ou chargeback anula o valor total da venda.

## O que decidi não fazer e por quê

- **Assinatura HMAC:** o token fixo é mais simples para o escopo. Em produção, eu usaria uma assinatura HMAC do corpo bruto com timestamp, para impedir adulteração e reenvio malicioso (*replay*).
- **Fila entre o recebimento e o processamento:** com o volume do desafio, a inserção direta é rápida. Com volume real, eu receberia, persistiria e responderia rápido, processando de forma assíncrona.
- **Status pendente (boleto/Pix gerado), reembolso parcial e múltiplas moedas:** fora do escopo de 3 a 4 horas.
- **Adaptadores para plataformas reais (Hotmart, Kiwify):** o formato normalizado foi pensado para permitir adicioná-los depois.
- **Eventos órfãos:** um reembolso sem aprovação correspondente fica armazenado, mas só aparece no relatório quando a aprovação chegar.
- **Testes automatizados:** os cenários (token, validação, duplicata, ordem de chegada, filtros) foram testados manualmente com o Postman. Seria o próximo passo, com Vitest e Supertest.
- **Ferramenta de migrations, rate limiting, paginação e observabilidade (logs estruturados, OpenTelemetry):** importantes em produção, mas além do escopo.
- **Fuso horário nos filtros:** os filtros usam UTC; em produção, o fuso seria configurável (ex.: `America/Sao_Paulo`).

## Como rodar localmente

```bash
git clone https://github.com/mtmattoz/twr-postbacks.git
cd twr-postbacks
npm install
cp .env.example .env   # preencha DATABASE_URL e WEBHOOK_SECRET
npm run dev
```

## Estrutura

```
src/
├── server.ts    # inicialização, rotas e tratamento de erros
├── db.ts        # conexão com o Postgres e criação da tabela
├── schema.ts    # schema de validação (Zod)
├── webhooks.ts  # POST /webhooks/sales
└── report.ts    # GET /report
```