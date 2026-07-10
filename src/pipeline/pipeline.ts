import { scanRings, DetectedRing } from '../detection/detect.js';
import { subgraph } from '../detection/queries.js';
import { investigate } from '../agent/investigator.js';
import { Verdict } from '../model.js';

export interface InvestigationInput {
  mode?: 'scan' | 'account'; // scan whole graph, or investigate a specific account's ring
  accountId?: string;
  minScore?: number;
  topN?: number;
}

export interface InvestigationResult {
  ringsFound: number;
  rings: Array<{
    evidence: DetectedRing;
    verdict: Verdict & { source: 'ai' | 'template' };
    graph: { nodes: any[]; edges: any[] };
  }>;
  generatedAtMs: number;
}

/**
 * The RingLeader investigation pipeline — the unit deployed to RocketRide Cloud.
 * Stages: (1) graph ring-detection in Neo4j → (2) LLM investigator reasoning →
 * (3) evidence subgraph for visualization → (4) structured verdict.
 */
export async function runInvestigation(
  input: InvestigationInput,
  nowMs: number = Date.now()
): Promise<InvestigationResult> {
  const topN = input.topN ?? 5;
  let rings = await scanRings(input.minScore ?? 35);

  if (input.mode === 'account' && input.accountId) {
    rings = rings.filter((r) => r.ringAccounts.includes(input.accountId!));
  }
  rings = rings.slice(0, topN);

  const enriched = [];
  for (const ring of rings) {
    const [verdict, graph] = await Promise.all([investigate(ring), subgraph(ring.ringAccounts)]);
    enriched.push({ evidence: ring, verdict, graph });
  }

  return { ringsFound: rings.length, rings: enriched, generatedAtMs: nowMs };
}
