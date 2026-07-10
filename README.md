# ◈ RingLeader — Agentic Fraud-Ring Detective

> **HackwithBay 3.0 submission.** An AI investigator that finds fraud *rings* hiding in a
> transaction network — fraud that is **invisible in the numbers and only exists in the
> relationships between accounts.**

**Live demo:** https://ringleader.butterbase.dev  (opens as a demo analyst automatically)

A single suspicious payment is easy to catch. A *ring* — many accounts secretly run by one
person — hides in plain sight, because every payment looks ordinary on its own. RingLeader
models the whole network as a Neo4j property graph, finds the rings with graph queries, and a
RocketRide Cloud pipeline explains each one in plain English with a recommended action.

---

## Platform

<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/86976368-e3b7-4239-b182-7b5ca4ef5077" />
<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/da461807-cdf4-46d1-9f5e-c25a457376a8" />
<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/24c2c62c-e642-4869-bd31-2923f88af68d" />
<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/18b3cf8e-77c2-4a56-bbbc-46c692fd3071" />
<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/183a7062-cc54-4aa9-ab2c-87b4eb3dd8d3" />
<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/3300a968-ed1f-4705-ad55-3c0e27ae2b49" />
<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/6420eb98-53da-4e92-985a-880a315e1e0c" />
<img width="1408" height="757" alt="image" src="https://github.com/user-attachments/assets/c0c8fc11-2da7-4094-932c-d8a8cd9bb228" />

---

## It catches three different kinds of fraud

The detector isn't a one-trick demo — it classifies distinct fraud typologies by their graph
signature (shared identifier × money-flow shape):

| Typology | Shared identifier | Money shape | What it is |
|----------|-------------------|-------------|------------|
| **Identity ring** | one **device** | **loop** (A→B→…→A) | one operator, many fake accounts, laundering by cycling money back to itself |
| **Money-mule network** | one **IP** | **funnel** (many → one collector) | mule accounts pushing deposits into a single collector |
| **Stolen-card ring** | one **card** | **fan-out** (one source → many) | stolen-card funds dispersed across cash-out mules |

---

## All three mandatory techs are load-bearing — this is the live request path

```
Browser (analyst)                 https://ringleader.butterbase.dev   ← Butterbase frontend hosting
   │  auto-login (Butterbase auth, JWT)
   ▼
Butterbase serverless function  /v1/app_6weti6gprado/fn/api           ← Butterbase functions runtime
   │
   ├─►  Neo4j Aura  (HTTP Query API)                                  ← GRAPH RING DETECTION
   │      shared-identity connected-components (device / IP / card)
   │      + money topology: cycles (a)-[:SENT*2..7]->(a), fan-in,
   │        fan-out + burst-signup + structuring signals
   │
   └─►  RocketRide Cloud pipeline  (POST /task → /task/data)          ← LLM INVESTIGATOR
          webhook → question → llm_openai_api → response_answers
          (the LLM node calls the Butterbase AI gateway)             ← Butterbase AI gateway
```

Remove **any** one and the product stops working:

| Tech | Load-bearing role | Verified |
|------|-------------------|----------|
| **Neo4j Aura** | The detection substrate. Rings are found with connected-components over shared devices/IPs/cards + **money-topology queries** (cycles / fan-in / fan-out) — impossible in SQL rows. | ✅ 197 accounts / 732 txns live; all 3 planted rings detected & classified |
| **RocketRide Cloud** | The deployed **investigator pipeline**. The Butterbase function POSTs each ring's evidence to the pipeline; the LLM node writes the verdict. Every production verdict is `source: "rocketride"`. | ✅ live pipeline, verdict returned via REST `/task` |
| **Butterbase** | Frontend hosting (live URL), analyst **auth** (JWT), the serverless **function** that orchestrates detection, the **AI gateway** that powers the RocketRide LLM node, and the **submission** path (MCP). | ✅ deployed app `app_6weti6gprado` |

---

## The demo (guided walkthrough, ~90 seconds)

1. Open **https://ringleader.butterbase.dev** → *"Some fraud only exists in the connections."*
   Click **Run the investigation**.
2. An **overview** appears: *"3 fraud rings found, hiding among 197 accounts"* — each shown as a
   card with its typology (Identity ring · Money-mule network · Stolen-card ring). Pick one.
3. A **step-by-step story** builds the case, one clue per screen, each backed by the **real graph
   data**:
   - *The setup* — a few of their payments, each *"✓ looks normal"*.
   - *Clue 1* — they all share one **device / IP / card** (the real identifier, straight from the graph).
   - *Clue 2* — the money **loops / funnels / fans out** (the real transaction trail with amounts).
   - *Clue 3* — they were created within minutes of each other, in structured sub-$10K amounts.
   - *The verdict* — written live by the **RocketRide Cloud** investigator, with a recommended action.

The dataset is deterministic (seeded), so the demo hits every time. `npm run scan` prints a
**precision check against ground truth**, proving the detector rediscovers the planted rings on
its own — it is never told which accounts are fraudulent.

---

## Run it locally

```bash
cp .env.example .env        # fill in Neo4j (required); AI gateway + RocketRide optional
npm install
npm run schema              # Neo4j constraints/indexes
npm run seed -- --wipe      # 197 accounts + 3 planted fraud typologies
npm run scan                # detector + ground-truth precision check (no LLM)
npm run investigate         # full agent verdict on the top ring (live AI)
npm run rocketride          # deploy + run the investigator pipeline on RocketRide Cloud
npm run server              # local API on :8787
cd web && npm install && npm run dev   # guided walkthrough on :5173
```

## Deploying the whole stack (what actually shipped)

Everything below was driven from the coding assistant over MCP + the platform SDKs/APIs:

- **Neo4j** — `npm run schema && npm run seed` against Aura.
- **RocketRide** — [`rocketride/investigator.pipe`](rocketride/investigator.pipe) deployed to RocketRide
  Cloud via the `rocketride` SDK; invoked in production over the REST `/task` API.
- **Butterbase** — app + public access + CORS via MCP; the detection/investigation API deployed as a
  serverless function ([`butterbase/functions/api.ts`](butterbase/functions/api.ts)); the React
  frontend built and deployed to `ringleader.butterbase.dev`.

## Layout

```
src/
  data/generate.ts      deterministic dataset w/ 3 planted typologies (ground truth)
  detection/            queries.ts (Cypher) · score.ts · detect.ts (union-find + rank)
  agent/                gateway.ts (OpenAI-compatible) · investigator.ts (LLM verdict)
  rocketride/run.ts     deploy + run the investigator pipeline on RocketRide Cloud
  butterbase/           mcp.ts (HTTP MCP client) · deployFn.ts · deployWeb.ts
  server.ts             local API (mirrors the deployed Butterbase function)
butterbase/functions/api.ts   the deployed serverless function (Neo4j + RocketRide + AI)
rocketride/investigator.pipe  the deployed RocketRide Cloud pipeline
web/                    React guided-walkthrough frontend (custom SVG, deployed to Butterbase)
```

Built for HackwithBay 3.0.
