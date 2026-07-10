import { Account, Txn, Link, GraphData } from '../model.js';

// Deterministic PRNG (mulberry32) so the planted ring is identical every run —
// crucial for a repeatable, reliable judge demo.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRIES = ['US', 'US', 'US', 'GB', 'CA', 'DE', 'IN', 'NG', 'BR', 'SG'];
const FIRST = ['Ava', 'Liam', 'Noah', 'Emma', 'Mia', 'Kai', 'Zoe', 'Leo', 'Ivy', 'Max', 'Sam', 'Ana', 'Ben', 'Cleo', 'Dev', 'Ella'];
const LAST = ['Cole', 'Reed', 'Vale', 'Kane', 'Frost', 'Marsh', 'Nash', 'Pryor', 'Quinn', 'Rowe', 'Shaw', 'Tate', 'Voss', 'Wren'];

export interface GenConfig {
  seed?: number;
  normalAccounts?: number;
  normalTxns?: number;
  rings?: number;
  ringSizeMin?: number;
  ringSizeMax?: number;
  baseTimeMs?: number; // anchor time for the dataset
}

export function generate(cfg: GenConfig = {}): GraphData {
  const rnd = mulberry32(cfg.seed ?? 42);
  const normalAccounts = cfg.normalAccounts ?? 180;
  const normalTxns = cfg.normalTxns ?? 700;
  const ringCount = cfg.rings ?? 2;
  const base = cfg.baseTimeMs ?? Date.parse('2026-07-01T00:00:00Z');
  const DAY = 86_400_000;

  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const between = (a: number, b: number) => a + rnd() * (b - a);

  const accounts: Account[] = [];
  const txns: Txn[] = [];
  const devices: Link[] = [];
  const ips: Link[] = [];
  const cards: Link[] = [];

  // ── Normal population ──
  for (let i = 0; i < normalAccounts; i++) {
    const id = `acc_${i.toString().padStart(4, '0')}`;
    const createdAtMs = Math.floor(base - between(0, 400 * DAY));
    accounts.push({
      id,
      name: `${pick(FIRST)} ${pick(LAST)}`,
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      country: pick(COUNTRIES),
      planted: false,
    });
    // each normal account has its own device / ip / card (occasionally shares — household noise)
    const shareHousehold = rnd() < 0.06 && i > 0;
    const devFp = shareHousehold ? `dev_${Math.floor(rnd() * i)}` : `dev_${i}`;
    devices.push({ account: id, value: devFp });
    ips.push({ account: id, value: `ip_${Math.floor(between(0, normalAccounts * 0.8))}` });
    cards.push({ account: id, value: `card_${i}` });
  }

  // ── Organic transactions (random pairs, human amounts) ──
  for (let i = 0; i < normalTxns; i++) {
    const from = pick(accounts).id;
    let to = pick(accounts).id;
    while (to === from) to = pick(accounts).id;
    const tsMs = Math.floor(base + between(0, 7 * DAY));
    txns.push({
      txnId: `txn_n_${i}`,
      from,
      to,
      amount: Math.round(between(5, 800) * 100) / 100,
      currency: 'USD',
      ts: new Date(tsMs).toISOString(),
      tsMs,
    });
  }

  // ── Planted fraud rings — three DISTINCT typologies ──
  // Each shares a different identifier and moves money in a different shape, so the
  // product demonstrates catching several kinds of fraud, not one.
  interface RingSpec { key: string; shared: 'device' | 'ip' | 'card'; topology: 'cycle' | 'fanin' | 'fanout'; sizeMin: number; sizeMax: number; structured: boolean; }
  const SPECS: RingSpec[] = [
    { key: 'identity', shared: 'device', topology: 'cycle', sizeMin: 5, sizeMax: 6, structured: true },   // one operator, many fake IDs
    { key: 'mule', shared: 'ip', topology: 'fanin', sizeMin: 6, sizeMax: 7, structured: true },            // money-mule funnel
    { key: 'card', shared: 'card', topology: 'fanout', sizeMin: 5, sizeMax: 6, structured: false },        // stolen-card cash-out
  ];
  const specs = SPECS.slice(0, cfg.rings ?? SPECS.length);

  specs.forEach((spec, r) => {
    const ringId = `ring_${spec.key}`;
    const size = Math.floor(between(spec.sizeMin, spec.sizeMax + 1));
    const burstStart = Math.floor(base - between(2 * DAY, 20 * DAY));
    const ringAccts: Account[] = [];

    for (let k = 0; k < size; k++) {
      const id = `acc_${spec.key}_${k}`;
      const createdAtMs = burstStart + Math.floor(between(0, 11 * 60_000)); // burst signup within ~11 min
      const acc: Account = {
        id, name: `${pick(FIRST)} ${pick(LAST)}`,
        createdAt: new Date(createdAtMs).toISOString(), createdAtMs,
        country: pick(COUNTRIES), planted: true, ringId,
      };
      accounts.push(acc);
      ringAccts.push(acc);
      // the ONE identifier they all share (the giveaway) — the rest are unique
      devices.push({ account: id, value: spec.shared === 'device' ? `dev_${ringId}` : `dev_${ringId}_${k}` });
      ips.push({ account: id, value: spec.shared === 'ip' ? `ip_${ringId}` : `ip_${ringId}_${k}` });
      cards.push({ account: id, value: spec.shared === 'card' ? `card_${ringId}` : `card_${ringId}_${k}` });
    }

    const flowStart = burstStart + 5 * DAY;
    const amt = () => spec.structured
      ? Math.round(between(9200, 9850) * 100) / 100   // structuring: just under $10k
      : Math.round(between(300, 1800) * 100) / 100;   // ordinary-sized card cash-outs
    let hop = 0;
    const push = (from: string, to: string) => {
      const tsMs = flowStart + hop * Math.floor(between(8 * 60_000, 35 * 60_000));
      txns.push({ txnId: `txn_${ringId}_${hop++}`, from, to, amount: amt(), currency: 'USD', ts: new Date(tsMs).toISOString(), tsMs });
    };

    if (spec.topology === 'cycle') {
      for (let k = 0; k < size; k++) push(ringAccts[k].id, ringAccts[(k + 1) % size].id);          // A→B→…→A
    } else if (spec.topology === 'fanin') {
      for (let k = 1; k < size; k++) push(ringAccts[k].id, ringAccts[0].id);                         // mules → collector
    } else { // fanout
      for (let k = 1; k < size; k++) push(ringAccts[0].id, ringAccts[k].id);                         // source → mules
    }

    // camouflage: a few small legit-looking outward payments
    for (let k = 0; k < size; k++) {
      const tsMs = flowStart + Math.floor(between(0, 3 * DAY));
      txns.push({ txnId: `txn_${ringId}_noise_${k}`, from: ringAccts[k].id, to: pick(accounts).id, amount: Math.round(between(10, 120) * 100) / 100, currency: 'USD', ts: new Date(tsMs).toISOString(), tsMs });
    }
  });

  return { accounts, txns, devices, ips, cards };
}
