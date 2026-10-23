# 09 — AI Management Advisor

Implementation: `advisor.service.ts`, reusing the existing `AiGatewayService` (provider abstraction, model via
`AI_MODEL`, JSON-schema structured output, typed errors, token usage audited as `AI_CALL`). No new provider.

## Read-only tools

`GET /engine/intelligence/advisor/tools/:name` — service-performance, resource-capacity, portfolio-forecast,
scenario-results, optimization-results, financial-alerts, benchmark-statistics. Each requires its own permission; people
are pseudonymised (resources by id and kind only). These tools are exactly the data sent to the model.

## Grounding

- The system prompt forbids inventing revenue, costs, rates, cash, capacity, probabilities or solver results.
- Every recommendation must cite evidence `{ ref, metric, value }`. Server-side, evidence is kept only if `ref` is an id
  present in the tool data **and** `value` appears verbatim in it; recommendations without verified evidence are
  discarded (`rejectedUngrounded` is returned).
- Stored as `engine_recommendations` with `source = AI`, `aiModel`, status PROPOSED and the benefit marked
  "AI interpretation — verify".
- `POST /advisor/ask` returns an answer with verified and unverified references, labelled AI_INTERPRETATION.

## Controls

Writes never come from the model: recommendations become decisions only through a human action, and decisions never change
contracts, prices, payroll or finance. Requires `engine.intelligence.create` + `engine.economics.read`. When AI is not
configured the gateway returns `503 AI_NOT_CONFIGURED`; the engine, alerts and rule-based recommendations
(`domain/intelligence.ts` → `ruleRecommendations`) keep working (verification case I).
