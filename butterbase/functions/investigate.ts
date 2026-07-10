// Butterbase serverless function (HTTP trigger).
// Deployed via the Butterbase MCP. This is the app's public investigation
// endpoint: it calls the RocketRide Cloud pipeline (graph detection + LLM),
// then persists the result as a case in Postgres.
//
// `bb` is the Butterbase function context (db, auth, env) injected at runtime.

interface Ctx {
  db: {
    from: (table: string) => {
      upsert: (row: any, opts?: { onConflict?: string }) => Promise<{ data: any; error: any }>;
      insert: (row: any) => Promise<{ data: any; error: any }>;
    };
  };
  auth: { uid: () => string | null };
  env: Record<string, string>;
  json: (body: any, status?: number) => Response;
}

function ringKey(accounts: string[]): string {
  return [...accounts].sort().join('|');
}

export default async function handler(req: Request, bb: Ctx): Promise<Response> {
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // 1) Run the deployed RocketRide pipeline (Neo4j detection + LLM investigator).
  const rr = await fetch(bb.env.ROCKETRIDE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bb.env.ROCKETRIDE_TOKEN}` },
    body: JSON.stringify({ mode: body.mode ?? 'scan', accountId: body.accountId, minScore: body.minScore ?? 35 }),
  });
  if (!rr.ok) return bb.json({ error: `pipeline ${rr.status}` }, 502);
  const result = await rr.json();

  // 2) Persist each detected ring as a case (idempotent on ring_key).
  const uid = bb.auth.uid();
  for (const r of result.rings ?? []) {
    const key = ringKey(r.evidence.ringAccounts);
    await bb.db.from('cases').upsert(
      {
        ring_key: key,
        severity: r.verdict.severity,
        score: r.verdict.score,
        headline: r.verdict.headline,
        explanation: r.verdict.explanation,
        recommended_action: r.verdict.recommendedAction,
        key_evidence: r.verdict.keyEvidence,
        ring_accounts: r.evidence.ringAccounts,
        graph_snapshot: r.graph,
        created_by: uid,
      },
      { onConflict: 'ring_key' }
    );
  }

  return bb.json(result);
}
