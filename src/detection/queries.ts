import { run } from '../neo4j.js';
import { RingEvidence } from '../model.js';

// Attributes shared by this many accounts (or more) are treated as suspicious
// identity links. Two people sharing a device happens; five sharing one is a ring.
export const SHARED_ATTR_MIN = 3;

export interface SharedAttr {
  value: string;
  accounts: string[];
  degree: number;
  kind: 'device' | 'ip' | 'card';
}

/** High-fanout shared attributes — the seeds of a ring. */
export async function sharedAttributes(): Promise<SharedAttr[]> {
  const q = (rel: string, label: string, prop: string, kind: SharedAttr['kind']) => run<SharedAttr>(
    `MATCH (a:Account)-[:${rel}]->(x:${label})
     WITH x, collect(DISTINCT a.id) AS accounts
     WITH x, accounts, size(accounts) AS degree
     WHERE degree >= $min
     RETURN x.${prop} AS value, accounts, degree, '${kind}' AS kind
     ORDER BY degree DESC`,
    { min: SHARED_ATTR_MIN }
  );
  const [devices, ips, cards] = await Promise.all([
    q('USED_DEVICE', 'Device', 'fingerprint', 'device'),
    q('USED_IP', 'Ip', 'addr', 'ip'),
    q('USED_CARD', 'Card', 'hash', 'card'),
  ]);
  return [...devices, ...ips, ...cards];
}

/** Circular money flow within a candidate account set: A→B→…→A. Pure Cypher. */
export async function moneyCycle(ids: string[]): Promise<{ cycle: string[]; amount: number } | null> {
  const rows = await run<{ cycle: string[]; amount: number }>(
    `MATCH p = (a:Account)-[:SENT*2..7]->(a)
     WHERE a.id IN $ids AND all(n IN nodes(p) WHERE n.id IN $ids)
     WITH [n IN nodes(p) | n.id] AS cycle,
          reduce(s = 0.0, r IN relationships(p) | s + r.amount) AS amount,
          length(p) AS len
     RETURN cycle, amount ORDER BY len DESC, amount DESC LIMIT 1`,
    { ids }
  );
  return rows[0] ?? null;
}

/** Full evidence bundle for a candidate ring (set of account ids). */
export async function gatherEvidence(ids: string[]): Promise<Omit<RingEvidence, 'signals' | 'score'>> {
  const [cycle, sharedDevices, sharedIps, sharedCards, window, flow, structuring] = await Promise.all([
    moneyCycle(ids),
    run<{ fingerprint: string; accounts: string[] }>(
      `MATCH (a:Account)-[:USED_DEVICE]->(d:Device)
       WHERE a.id IN $ids
       WITH d, collect(a.id) AS accounts WHERE size(accounts) >= 2
       RETURN d.fingerprint AS fingerprint, accounts`,
      { ids }
    ),
    run<{ addr: string; accounts: string[] }>(
      `MATCH (a:Account)-[:USED_IP]->(i:Ip)
       WHERE a.id IN $ids
       WITH i, collect(a.id) AS accounts WHERE size(accounts) >= 2
       RETURN i.addr AS addr, accounts`,
      { ids }
    ),
    run<{ hash: string; accounts: string[] }>(
      `MATCH (a:Account)-[:USED_CARD]->(c:Card)
       WHERE a.id IN $ids
       WITH c, collect(a.id) AS accounts WHERE size(accounts) >= 2
       RETURN c.hash AS hash, accounts`,
      { ids }
    ),
    run<{ minMs: number; maxMs: number }>(
      `MATCH (a:Account) WHERE a.id IN $ids
       RETURN min(a.createdAtMs) AS minMs, max(a.createdAtMs) AS maxMs`,
      { ids }
    ),
    run<{ total: number }>(
      `MATCH (a:Account)-[r:SENT]->(b:Account)
       WHERE a.id IN $ids AND b.id IN $ids
       RETURN sum(r.amount) AS total`,
      { ids }
    ),
    run<{ count: number }>(
      `MATCH (a:Account)-[r:SENT]->(b:Account)
       WHERE a.id IN $ids AND b.id IN $ids AND r.amount >= 9000 AND r.amount < 10000
       RETURN count(r) AS count`,
      { ids }
    ),
  ]);

  const windowMinutes =
    window[0]?.maxMs != null ? Math.round((window[0].maxMs - window[0].minMs) / 60000) : undefined;

  return {
    ringAccounts: ids,
    size: ids.length,
    cycle: cycle?.cycle,
    cycleAmount: cycle?.amount,
    sharedDevices,
    sharedIps,
    sharedCards,
    creationWindowMinutes: windowMinutes,
    totalFlow: flow[0]?.total ?? 0,
    structuringCount: structuring[0]?.count ?? 0,
  };
}

/** Subgraph around a set of accounts, shaped for the force-graph viz. */
export async function subgraph(ids: string[]) {
  const nodes = await run(
    `MATCH (a:Account) WHERE a.id IN $ids
     OPTIONAL MATCH (a)-[:USED_DEVICE]->(d:Device)
     OPTIONAL MATCH (a)-[:USED_IP]->(i:Ip)
     RETURN a.id AS id, a.name AS name, a.country AS country,
            a.createdAt AS createdAt, a.planted AS planted,
            collect(DISTINCT d.fingerprint) AS devices,
            collect(DISTINCT i.addr) AS ips`,
    { ids }
  );
  const edges = await run(
    `MATCH (a:Account)-[r:SENT]->(b:Account)
     WHERE a.id IN $ids AND b.id IN $ids
     RETURN a.id AS source, b.id AS target, r.amount AS amount, r.ts AS ts`,
    { ids }
  );
  return { nodes, edges };
}

/** The whole transaction network, shaped for the force-graph viz. */
export async function fullGraph(limit = 1500) {
  const nodes = await run(
    `MATCH (a:Account)
     OPTIONAL MATCH (a)-[:USED_DEVICE]->(d:Device)
     RETURN a.id AS id, a.name AS name, a.country AS country,
            a.planted AS planted, collect(DISTINCT d.fingerprint) AS devices
     LIMIT toInteger($limit)`,
    { limit }
  );
  const edges = await run(
    `MATCH (a:Account)-[r:SENT]->(b:Account)
     RETURN a.id AS source, b.id AS target, r.amount AS amount, r.ts AS ts
     LIMIT toInteger($limit)`,
    { limit }
  );
  return { nodes, edges };
}

/** Ground-truth planted rings (evaluation only — never used by the detector). */
export async function groundTruthRings() {
  return run<{ ringId: string; accounts: string[] }>(
    `MATCH (a:Account) WHERE a.planted = true
     WITH a.ringId AS ringId, collect(a.id) AS accounts
     RETURN ringId, accounts ORDER BY ringId`
  );
}
