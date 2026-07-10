import { sharedAttributes, gatherEvidence, SharedAttr } from './queries.js';
import { scoreEvidence, severityFor } from './score.js';
import { RingEvidence } from '../model.js';

// ── Union-Find: merge accounts linked by shared identity into candidate clusters.
// "Who is connected to whom through shared devices/IPs" is itself a graph problem —
// this is the connected-components step the ring detector is built on.
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
  groups(): string[][] {
    const g = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      (g.get(r) ?? g.set(r, []).get(r)!).push(x);
    }
    return [...g.values()];
  }
}

export interface DetectedRing extends RingEvidence {
  severity: 'low' | 'medium' | 'high' | 'critical';
  seedAttributes: { kind: string; value: string }[];
}

/**
 * Full scan: seed clusters from high-fanout shared attributes, union overlapping
 * ones, gather graph evidence per cluster, score, and rank.
 */
export async function scanRings(minScore = 35): Promise<DetectedRing[]> {
  const attrs: SharedAttr[] = await sharedAttributes();
  const uf = new UnionFind();
  const seedByRoot = new Map<string, { kind: string; value: string }[]>();

  for (const attr of attrs) {
    const [first, ...rest] = attr.accounts;
    for (const other of rest) uf.union(first, other);
    // record which attribute seeded this cluster
    const root = uf.find(first);
    const list = seedByRoot.get(root) ?? [];
    list.push({ kind: attr.kind, value: attr.value });
    seedByRoot.set(root, list);
  }

  const clusters = uf.groups().filter((c) => c.length >= 3);
  const rings: DetectedRing[] = [];

  for (const ids of clusters) {
    const evidence = await gatherEvidence(ids);
    const scored = scoreEvidence(evidence);
    if (scored.score < minScore) continue;
    // seed attributes may live under any member's root; collect from all members
    const seeds = new Map<string, { kind: string; value: string }>();
    for (const id of ids) {
      for (const s of seedByRoot.get(uf.find(id)) ?? []) seeds.set(`${s.kind}:${s.value}`, s);
    }
    rings.push({
      ...scored,
      severity: severityFor(scored.score),
      seedAttributes: [...seeds.values()],
    });
  }

  return rings.sort((a, b) => b.score - a.score);
}
