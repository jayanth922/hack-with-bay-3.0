# RingLeader — Deployment & Submission Runbook

This is the exact path from local code → three live clouds → submitted. Steps marked
**[you]** need your account/credentials; steps marked **[claude]** I can drive for you
once the relevant MCP is connected to this session.

---

## 0. Accounts (≈20 min) — **[you]**

| Service | Do this | You end up with |
|---------|---------|-----------------|
| **Neo4j Aura** | [console.neo4j.io](https://console.neo4j.io) → *Create Instance* → **AuraDB Free** → download the credentials file | `NEO4J_URI`, `NEO4J_PASSWORD` |
| **Butterbase** | [dashboard.butterbase.ai](https://dashboard.butterbase.ai) → sign up → Billing → **Launch plan** → apply promo **`ENJOY0707`** | app + AI gateway key |
| **RocketRide** | [rocketride.org](https://rocketride.org) → sign up → get Cloud deploy token | `ROCKETRIDE_TOKEN` |

Then: `cp .env.example .env` and paste in the Neo4j values. That alone unlocks the full
local demo (`npm run schema && npm run seed -- --wipe && npm run server`).

---

## 1. Connect the MCP servers to this session — **[you]**

In Claude Code:

```bash
claude mcp add butterbase -- npx -y @butterbase/mcp
claude mcp add rocketride -- npx -y @rocketride/mcp    # confirm exact pkg from docs.rocketride.org
```

Once connected, tell me **"the Butterbase and RocketRide MCPs are connected"** and I'll take
over the cloud steps below. (I'll load their tool schemas via ToolSearch and drive them.)

---

## 2. Neo4j — load the graph — **[claude]**

```bash
npm run schema
npm run seed -- --wipe      # deterministic ~190 accounts + planted rings
npm run scan                # confirm detection + ground-truth precision
```

---

## 3. RocketRide — deploy the investigation pipeline — **[claude]**

- Source of truth: [`src/pipeline/pipeline.json`](src/pipeline/pipeline.json) +
  [`src/pipeline/pipeline.ts`](src/pipeline/pipeline.ts) (`runInvestigation` is the deployed unit).
- I reconcile node types against the live RocketRide node registry via its MCP / the
  [Pipeline JSON Reference](https://docs.rocketride.org), set the `NEO4J_*` and `AI_*`
  env on the pipeline, then **deploy to RocketRide Cloud**.
- Output: a production endpoint URL → paste into `ROCKETRIDE_ENDPOINT`.
- Smoke test: `curl -XPOST $ROCKETRIDE_ENDPOINT -d '{"mode":"scan"}'`.

## 4. Butterbase — backend + frontend — **[claude via MCP]**

1. **Schema:** apply [`butterbase/schema.json`](butterbase/schema.json) (cases + audit, RLS on).
2. **Auth:** enable email + one OAuth provider for analyst login.
3. **Functions:** deploy [`butterbase/functions/investigate.ts`](butterbase/functions/investigate.ts)
   (HTTP), set env `ROCKETRIDE_ENDPOINT`, `ROCKETRIDE_TOKEN`.
4. **Frontend:** `cd web && npm run build`, then deploy `web/dist` to Butterbase → **live URL**.
   Point the frontend's `/api/*` at the Butterbase functions (they mirror `src/server.ts`).

## 5. Submit — **[claude via Butterbase MCP]**

Paste into the agent (the docs' exact submission string):

```
Submit my project to the hackathon. Submission code: ENJOY0707
```

Hackathon slug: **`Hackwithbay-0707`**. Deliverables to have ready: live URL, this repo,
the project description (README), and an optional 90s demo video (script in README).

---

## Bonus integrations (if time allows) — extra credit

- **Daytona:** run analyst-authored custom Cypher/JS detection rules in a sandbox before
  they touch the live graph. Hook point: a new `POST /api/rules/test` that executes in Daytona.
- **Cognee:** give the investigator memory — store confirmed ring fingerprints (devices, IP
  ranges, behavioral patterns) so a new scan can say *"device matches ring flagged last week."*
  Hook point: write in `butterbase/functions/investigate.ts` after a case is confirmed; read in
  `src/agent/investigator.ts` before composing the verdict.

## Pre-submission checklist

- [ ] `npm run scan` detects every planted ring (precision check passes)
- [ ] RocketRide endpoint returns a verdict via `curl`
- [ ] Dashboard live URL loads on Butterbase, Scan lights up the ring
- [ ] A case row appears in Butterbase Postgres after a scan
- [ ] All three techs demonstrably in the flow (screen-record it)
- [ ] Submitted via Butterbase MCP with code `ENJOY0707`
