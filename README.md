# ◈ RingLeader — Agentic Fraud-Ring Detective

> **HackwithBay 3.0 submission.** An AI investigator that finds fraud *rings* hiding in a
> transaction network — fraud that is **invisible in SQL rows and only exists in the
> relationships between accounts.**

**Live demo:** https://ringleader.butterbase.dev  (opens as a demo analyst automatically)

Every individual transaction looks clean. RingLeader models the whole network as a Neo4j
property graph, runs graph detection to surface coordinated rings, and a RocketRide Cloud
pipeline reasons over the evidence to explain each ring in plain English with a recommended action.

---

## All three mandatory techs are load-bearing — this is the live request path

```
Browser (analyst)                 https://ringleader.butterbase.dev   ← Butterbase frontend hosting
   │  auto-login (Butterbase auth, JWT)
   ▼
Butterbase serverless function  /v1/app_6weti6gprado/fn/api           ← Butterbase functions runtime
   │
   ├─►  Neo4j Aura  (HTTP Query API)                                  ← GRAPH RING DETECTION
   │      shared-identity connected-components + circular money-flow
   │      paths  (a)-[:SENT*2..7]->(a)  + structuring signals
   │
   └─►  RocketRide Cloud pipeline  (POST /task → /task/data)          ← LLM INVESTIGATOR
          webhook → question → llm_openai_api → response_answers
          (the LLM node calls the Butterbase AI gateway)             ← Butterbase AI gateway
```

Remove **any** one and the product stops working:

| Tech | Load-bearing role | Verified |
|------|-------------------|----------|
| **Neo4j Aura** | The detection substrate. Rings are found with connected-components over shared devices/IPs + **circular money-flow path queries** — impossible in SQL rows. | ✅ 192 accounts / 724 txns live; both planted rings detected 100/100 |
| **RocketRide Cloud** | The deployed **investigator pipeline**. The Butterbase function POSTs ring evidence to the pipeline; the LLM node produces the verdict. Every production verdict is `source: "rocketride"`. | ✅ live pipeline, verdict returned via REST `/task` |
| **Butterbase** | Frontend hosting (live URL), analyst **auth** (JWT), the serverless **function** runtime that orchestrates detection, the **AI gateway** that powers the RocketRide LLM node, and the **submission** path (MCP). | ✅ deployed app `app_6weti6gprado` |

---

## The demo (90 seconds)

1. Open **https://ringleader.butterbase.dev**. A dense network of **~190 accounts / hundreds of
   transactions** floats on screen. Nothing looks wrong.
2. Click **⚡ Scan for fraud rings**. The Butterbase function runs graph detection in Neo4j, then
   sends the evidence to the RocketRide Cloud pipeline.
3. **The ring lights up red** inside the mess — a tight cluster with money circling back to its
   origin, particles flowing along the cycle.
4. The RocketRide pipeline's verdict appears in plain English:
   *"7-account circular ring moves $67K, shares one device, dodges the $10K CTR limit — freeze accounts and file a SAR."*

The planted ring is deterministic (seeded), so the demo hits every time. `npm run scan` prints a
**precision check against ground truth** proving the detector actually works.

---

## Run it locally

```bash
cp .env.example .env        # fill in Neo4j (required); AI gateway + RocketRide optional
npm install
npm run schema              # Neo4j constraints/indexes
npm run seed -- --wipe      # ~190 accounts + planted fraud rings
npm run scan                # detector + ground-truth precision check (no LLM)
npm run investigate         # full agent verdict on the top ring (live AI)
npm run rocketride          # deploy + run the investigator pipeline on RocketRide Cloud
npm run server              # local API on :8787
cd web && npm install && npm run dev   # dashboard on :5173
```

## Deploying the whole stack (what actually shipped)

Everything below was driven from the coding assistant over MCP + the platform SDKs/APIs:

- **Neo4j** — `npm run schema && npm run seed` against Aura.
- **RocketRide** — [`rocketride/investigator.pipe`](rocketride/investigator.pipe) deployed to RocketRide
  Cloud via the `rocketride` SDK; invoked in production over the REST `/task` API.
- **Butterbase** — app + public access + CORS via MCP; the detection/investigation API deployed as a
  serverless function ([`butterbase/functions/api.ts`](butterbase/functions/api.ts)); the React
  dashboard built and deployed to `ringleader.butterbase.dev`.

## Layout

```
src/
  data/generate.ts      deterministic dataset w/ planted rings (ground truth)
  detection/            queries.ts (Cypher) · score.ts · detect.ts (union-find + rank)
  agent/                gateway.ts (OpenAI-compatible) · investigator.ts (LLM verdict)
  pipeline/             local pipeline runner mirroring the deployed flow
  rocketride/run.ts     deploy + run the investigator pipeline on RocketRide Cloud
  butterbase/           mcp.ts (HTTP MCP client) · deployFn.ts (function deploy)
  server.ts             local API (mirrors the deployed Butterbase function)
butterbase/functions/api.ts   the deployed serverless function (Neo4j + RocketRide + AI)
rocketride/investigator.pipe  the deployed RocketRide Cloud pipeline
web/                    React + react-force-graph dashboard (deployed to Butterbase)
```

Built for HackwithBay 3.0.
