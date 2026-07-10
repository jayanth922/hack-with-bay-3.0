// RingLeader API — a single self-contained Butterbase serverless function.
// Routes: GET ?op=health | ?op=graph | ?op=scan ; POST (body {mode}) = investigate.
// Queries Neo4j via the Aura HTTP Query API and reasons with the Butterbase AI gateway.
//
// envVars required:
//   NEO4J_QUERY_URL  e.g. https://<id>.databases.neo4j.io/db/<db>/query/v2
//   NEO4J_AUTH_B64   base64("user:password")
//   AI_BASE_URL      e.g. https://api.butterbase.ai/v1
//   AI_KEY           bb_sk_...
//   AI_MODEL         e.g. anthropic/claude-sonnet-5

const SHARED_ATTR_MIN = 3;

export default async function handler(req: Request, ctx: any): Promise<Response> {
  const env = ctx.env;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

  // ── Neo4j HTTP Query API ──
  async function cypher(statement: string, parameters: Record<string, any> = {}): Promise<any[]> {
    const res = await fetch(env.NEO4J_QUERY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${env.NEO4J_AUTH_B64}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Connection: 'close',
      },
      body: JSON.stringify({ statement, parameters }),
    });
    const data = await res.json();
    if (data.errors?.length) throw new Error(data.errors[0].message);
    const fields: string[] = data.data.fields;
    return data.data.values.map((row: any[]) => {
      const o: Record<string, any> = {};
      fields.forEach((f, i) => (o[f] = row[i]));
      return o;
    });
  }

  // ── AI gateway (with retry for the gateway's occasional premature close) ──
  async function aiChat(messages: any[]): Promise<string> {
    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.AI_KEY}`, 'Content-Type': 'application/json', Connection: 'close' },
          body: JSON.stringify({ model: env.AI_MODEL, messages, temperature: 0.2 }),
        });
        if (!res.ok) throw new Error(`AI ${res.status}`);
        const j = await res.json();
        return j.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    throw lastErr;
  }

  function extractJson(raw: string): any {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const c = fenced ? fenced[1] : raw;
    const s = c.indexOf('{'), e = c.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('no json');
    return JSON.parse(c.slice(s, e + 1));
  }

  // ── RocketRide Cloud pipeline (REST): load pipeline -> send evidence ->
  // process -> fetch the LLM verdict. This is the deployed production endpoint. ──
  function rrConfigured(): boolean {
    return Boolean(env.ROCKETRIDE_KEY && env.ROCKETRIDE_PIPE);
  }
  async function rrInvestigate(prompt: string): Promise<string> {
    const base = env.ROCKETRIDE_BASE || 'https://api.rocketride.ai';
    const H = { Authorization: `Bearer ${env.ROCKETRIDE_KEY}` };
    const jf = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
    // Ephemeral run: nonce the pipeline id so every call gets a fresh token
    // (no "already running" conflicts), send evidence (verdict returns inline),
    // then terminate to avoid leaking instances.
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const pipe = env.ROCKETRIDE_PIPE.replace(/"project_id":\s*"[^"]*"/, `"project_id": "ringleader-${nonce}"`);
    const load = await jf(await fetch(`${base}/task`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: pipe,
    }));
    const token = load?.data?.token;
    if (!token) throw new Error('rocketride start: ' + JSON.stringify(load).slice(0, 150));
    try {
      const dr = await jf(await fetch(`${base}/task/data?token=${token}&mimetype=text/plain`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'text/plain' }, body: prompt,
      }));
      const answers = dr?.data?.objects?.body?.answers;
      if (answers && answers.length) return Array.isArray(answers) ? answers[0] : answers;
      throw new Error('rocketride no verdict: ' + JSON.stringify(dr).slice(0, 150));
    } finally {
      fetch(`${base}/task?token=${token}`, { method: 'DELETE', headers: H }).catch(() => {});
    }
  }

  // ── Graph queries (ported, Aura-Free-safe pure Cypher) ──
  async function sharedAttributes() {
    const q = (rel: string, label: string, prop: string, kind: string) =>
      cypher(
        `MATCH (a:Account)-[:${rel}]->(x:${label})
         WITH x, collect(DISTINCT a.id) AS accounts
         WITH x, accounts, size(accounts) AS degree
         WHERE degree >= $min
         RETURN x.${prop} AS value, accounts, degree, '${kind}' AS kind
         ORDER BY degree DESC`,
        { min: SHARED_ATTR_MIN }
      );
    const [d, i, c] = await Promise.all([
      q('USED_DEVICE', 'Device', 'fingerprint', 'device'),
      q('USED_IP', 'Ip', 'addr', 'ip'),
      q('USED_CARD', 'Card', 'hash', 'card'),
    ]);
    return [...d, ...i, ...c];
  }

  async function moneyCycle(ids: string[]) {
    const rows = await cypher(
      `MATCH p = (a:Account)-[:SENT*2..7]->(a)
       WHERE a.id IN $ids AND all(n IN nodes(p) WHERE n.id IN $ids)
       WITH [n IN nodes(p) | n.id] AS cycle,
            reduce(s = 0.0, r IN relationships(p) | s + r.amount) AS amount, length(p) AS len
       RETURN cycle, amount ORDER BY len DESC, amount DESC LIMIT 1`,
      { ids }
    );
    return rows[0] ?? null;
  }

  async function gatherEvidence(ids: string[]) {
    const [cycle, sharedDevices, sharedIps, sharedCards, window, flow, structuring] = await Promise.all([
      moneyCycle(ids),
      cypher(`MATCH (a:Account)-[:USED_DEVICE]->(d:Device) WHERE a.id IN $ids
              WITH d, collect(a.id) AS accounts WHERE size(accounts) >= 2
              RETURN d.fingerprint AS fingerprint, accounts`, { ids }),
      cypher(`MATCH (a:Account)-[:USED_IP]->(i:Ip) WHERE a.id IN $ids
              WITH i, collect(a.id) AS accounts WHERE size(accounts) >= 2
              RETURN i.addr AS addr, accounts`, { ids }),
      cypher(`MATCH (a:Account)-[:USED_CARD]->(c:Card) WHERE a.id IN $ids
              WITH c, collect(a.id) AS accounts WHERE size(accounts) >= 2
              RETURN c.hash AS hash, accounts`, { ids }),
      cypher(`MATCH (a:Account) WHERE a.id IN $ids
              RETURN min(a.createdAtMs) AS minMs, max(a.createdAtMs) AS maxMs`, { ids }),
      cypher(`MATCH (a:Account)-[r:SENT]->(b:Account) WHERE a.id IN $ids AND b.id IN $ids
              RETURN sum(r.amount) AS total`, { ids }),
      cypher(`MATCH (a:Account)-[r:SENT]->(b:Account)
              WHERE a.id IN $ids AND b.id IN $ids AND r.amount >= 9000 AND r.amount < 10000
              RETURN count(r) AS count`, { ids }),
    ]);
    const w = window[0];
    const windowMinutes = w?.maxMs != null ? Math.round((w.maxMs - w.minMs) / 60000) : undefined;
    return {
      ringAccounts: ids, size: ids.length,
      cycle: cycle?.cycle, cycleAmount: cycle?.amount,
      sharedDevices, sharedIps, sharedCards,
      creationWindowMinutes: windowMinutes,
      totalFlow: flow[0]?.total ?? 0,
      structuringCount: structuring[0]?.count ?? 0,
    };
  }

  // Link-analysis subgraph: accounts + the shared device/IP nodes they converge on
  // + money-flow edges. The shared-identity nodes make the ring visually obvious.
  async function subgraph(ids: string[]) {
    const accounts = await cypher(
      `MATCH (a:Account) WHERE a.id IN $ids
       RETURN a.id AS id, a.name AS name, a.country AS country, a.createdAt AS createdAt, a.planted AS planted`,
      { ids }
    );
    const transfers = await cypher(
      `MATCH (a:Account)-[r:SENT]->(b:Account) WHERE a.id IN $ids AND b.id IN $ids
       RETURN a.id AS source, b.id AS target, r.amount AS amount, r.ts AS ts`,
      { ids }
    );
    const devices = await cypher(
      `MATCH (a:Account)-[:USED_DEVICE]->(d:Device) WHERE a.id IN $ids
       WITH d, collect(a.id) AS accounts WHERE size(accounts) >= 2
       RETURN 'dev:' + d.fingerprint AS id, 'device' AS kind, d.fingerprint AS label, accounts`,
      { ids }
    );
    const ipsShared = await cypher(
      `MATCH (a:Account)-[:USED_IP]->(i:Ip) WHERE a.id IN $ids
       WITH i, collect(a.id) AS accounts WHERE size(accounts) >= 2
       RETURN 'ip:' + i.addr AS id, 'ip' AS kind, i.addr AS label, accounts`,
      { ids }
    );
    return { accounts, transfers, identities: [...devices, ...ipsShared] };
  }

  async function fullGraph(limit = 1500) {
    const nodes = await cypher(
      `MATCH (a:Account)
       OPTIONAL MATCH (a)-[:USED_DEVICE]->(d:Device)
       RETURN a.id AS id, a.name AS name, a.country AS country, a.planted AS planted,
              collect(DISTINCT d.fingerprint) AS devices LIMIT toInteger($limit)`,
      { limit }
    );
    const edges = await cypher(
      `MATCH (a:Account)-[r:SENT]->(b:Account)
       RETURN a.id AS source, b.id AS target, r.amount AS amount, r.ts AS ts LIMIT toInteger($limit)`,
      { limit }
    );
    return { nodes, edges };
  }

  // ── Scoring ──
  function scoreEvidence(e: any) {
    const signals: string[] = [];
    let score = 0;
    if (e.cycle && e.cycle.length >= 3) {
      score += 35;
      signals.push(`Circular money flow across ${e.cycle.length - 1} accounts totaling $${Math.round(e.cycleAmount ?? 0).toLocaleString()} — funds return to the origin (classic layering).`);
    }
    const bigDevice = e.sharedDevices.find((d: any) => d.accounts.length >= 3);
    if (bigDevice) { score += 25; signals.push(`${bigDevice.accounts.length} accounts share device ${bigDevice.fingerprint} — one operator, many identities.`); }
    else if (e.sharedDevices.length) { score += 10; signals.push(`Shared device across ${e.sharedDevices[0].accounts.length} accounts.`); }
    const bigIp = e.sharedIps.find((i: any) => i.accounts.length >= 3);
    if (bigIp) { score += 15; signals.push(`${bigIp.accounts.length} accounts share IP ${bigIp.addr}.`); }
    if (e.creationWindowMinutes != null && e.size >= 3 && e.creationWindowMinutes <= 60) {
      score += 15; signals.push(`All ${e.size} accounts created within ${e.creationWindowMinutes} min of each other — coordinated burst signup.`);
    }
    if (e.structuringCount >= 2) { score += 10; signals.push(`${e.structuringCount} transfers sized just under the $10k reporting threshold (structuring).`); }
    score = Math.min(100, score);
    return { ...e, signals, score };
  }
  const severityFor = (s: number) => (s >= 80 ? 'critical' : s >= 60 ? 'high' : s >= 35 ? 'medium' : 'low');

  // ── Union-Find clustering + scan ──
  function scanClusters(attrs: any[]): { clusters: string[][]; seedByRoot: Map<string, any[]> } {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      let r = x; while (parent.get(r) !== r) r = parent.get(r)!;
      let c = x; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
      return r;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));
    const seedByRoot = new Map<string, any[]>();
    for (const attr of attrs) {
      const [first, ...rest] = attr.accounts;
      for (const o of rest) union(first, o);
      const root = find(first);
      const list = seedByRoot.get(root) ?? [];
      list.push({ kind: attr.kind, value: attr.value });
      seedByRoot.set(root, list);
    }
    const groups = new Map<string, string[]>();
    for (const x of parent.keys()) { const r = find(x); (groups.get(r) ?? groups.set(r, []).get(r)!).push(x); }
    return { clusters: [...groups.values()].filter((c) => c.length >= 3), seedByRoot };
  }

  async function scanRings(minScore = 35) {
    const attrs = await sharedAttributes();
    const { clusters } = scanClusters(attrs);
    const rings = [];
    for (const ids of clusters) {
      const scored = scoreEvidence(await gatherEvidence(ids));
      if (scored.score < minScore) continue;
      rings.push({ ...scored, severity: severityFor(scored.score) });
    }
    return rings.sort((a, b) => b.score - a.score);
  }

  // ── Investigator ──
  function templateVerdict(ring: any) {
    const cycleTxt = ring.cycle && ring.cycleAmount
      ? `funds cycle ${ring.cycle.slice(0, ring.cycle.length - 1).join(' → ')} → back to origin, moving ~$${Math.round(ring.cycleAmount).toLocaleString()}`
      : 'accounts move funds among themselves';
    return {
      ringAccounts: ring.ringAccounts, score: ring.score, severity: ring.severity,
      headline: `${ring.severity.toUpperCase()} risk fraud ring: ${ring.size} accounts, ${cycleTxt}`,
      explanation: `These ${ring.size} accounts behave as a single coordinated operation. ${ring.signals.join(' ')} In isolation each transaction looks ordinary; only the graph reveals the ring.`,
      recommendedAction: ring.score >= 60
        ? 'Freeze all accounts in the ring, file a SAR, and escalate to the fraud investigations team.'
        : 'Flag for manual review and monitor for further coordinated activity.',
      keyEvidence: ring.signals.slice(0, 5),
      source: 'template',
    };
  }

  const INSTRUCTIONS = `You are RingLeader, an expert financial-crime investigator AI. You are given structured graph evidence about a suspected fraud ring in a Neo4j transaction network. Explain in plain English WHY these accounts form a fraud ring and what to do. Cite specific accounts, amounts, shared devices, timing. Emphasize what only the GRAPH reveals. Return STRICT JSON: {"headline":"<=90 chars","explanation":"2-4 sentences","recommendedAction":"1-2 sentences","keyEvidence":["3-5 short strings"]}.`;

  function evidencePrompt(ring: any): string {
    return INSTRUCTIONS + '\n\nEvidence:\n' + JSON.stringify({
      accounts: ring.ringAccounts, riskScore: ring.score, moneyCycle: ring.cycle,
      moneyCycleTotalUSD: ring.cycleAmount, totalFlowUSD: ring.totalFlow,
      sharedDevices: ring.sharedDevices, sharedIps: ring.sharedIps,
      accountCreationWindowMinutes: ring.creationWindowMinutes,
      transfersJustUnder10kThreshold: ring.structuringCount, detectedSignals: ring.signals,
    }, null, 2);
  }

  async function investigate(ring: any) {
    // Primary path: the deployed RocketRide Cloud pipeline generates the verdict.
    if (rrConfigured()) {
      try {
        const raw = await rrInvestigate(evidencePrompt(ring));
        const j = extractJson(raw);
        return {
          ringAccounts: ring.ringAccounts, score: ring.score, severity: severityFor(ring.score),
          headline: j.headline ?? templateVerdict(ring).headline,
          explanation: j.explanation ?? '', recommendedAction: j.recommendedAction ?? '',
          keyEvidence: Array.isArray(j.keyEvidence) ? j.keyEvidence : ring.signals, source: 'rocketride',
        };
      } catch (e) { /* fall through to direct gateway */ }
    }
    // Fallback: call the AI gateway directly.
    try {
      const raw = await aiChat([
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content: evidencePrompt(ring) },
      ]);
      const j = extractJson(raw);
      return {
        ringAccounts: ring.ringAccounts, score: ring.score, severity: severityFor(ring.score),
        headline: j.headline ?? templateVerdict(ring).headline,
        explanation: j.explanation ?? '', recommendedAction: j.recommendedAction ?? '',
        keyEvidence: Array.isArray(j.keyEvidence) ? j.keyEvidence : ring.signals, source: 'ai',
      };
    } catch { return templateVerdict(ring); }
  }

  // ── Router ──
  try {
    const url = new URL(req.url);
    const op = url.searchParams.get('op');

    if (req.method === 'GET' && op === 'health') return json({ ok: true });
    if (req.method === 'GET' && op === 'graph') return json(await fullGraph());
    if (req.method === 'GET' && op === 'scan') {
      const rings = await scanRings();
      const withGraph = [];
      for (const r of rings) withGraph.push({ ...r, graph: await subgraph(r.ringAccounts) });
      return json({ rings: withGraph });
    }
    // POST = full investigation (detector + LLM + subgraph)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    let rings = await scanRings(body.minScore ?? 35);
    if (body.mode === 'account' && body.accountId) rings = rings.filter((r) => r.ringAccounts.includes(body.accountId));
    rings = rings.slice(0, body.topN ?? 5);
    const enriched = [];
    for (const ring of rings) {
      const [verdict, graph] = await Promise.all([investigate(ring), subgraph(ring.ringAccounts)]);
      enriched.push({ evidence: ring, verdict, graph });
    }
    return json({ ringsFound: rings.length, rings: enriched });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}
