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

  // ── Planted fraud rings ──
  // Each ring: N accounts, all created within minutes, sharing a device + IP,
  // cycling money A->B->...->A in structured amounts just under $10k.
  for (let r = 0; r < ringCount; r++) {
    const ringId = `ring_${r}`;
    const size = Math.floor(between(cfg.ringSizeMin ?? 5, (cfg.ringSizeMax ?? 7) + 1));
    const burstStart = Math.floor(base - between(2 * DAY, 20 * DAY));
    const sharedDevice = `dev_ring_${r}`;
    const sharedIp = `ip_ring_${r}`;
    const ringAccts: Account[] = [];

    for (let k = 0; k < size; k++) {
      const id = `acc_ring${r}_${k}`;
      const createdAtMs = burstStart + Math.floor(between(0, 12 * 60_000)); // within 12 min
      const acc: Account = {
        id,
        name: `${pick(FIRST)} ${pick(LAST)}`,
        createdAt: new Date(createdAtMs).toISOString(),
        createdAtMs,
        country: pick(COUNTRIES),
        planted: true,
        ringId,
      };
      accounts.push(acc);
      ringAccts.push(acc);
      // shared device + IP across the whole ring; cards differ (mule cards)
      devices.push({ account: id, value: sharedDevice });
      // most share the IP; one uses a decoy to add realism
      ips.push({ account: id, value: k === size - 1 ? `ip_${Math.floor(rnd() * 50)}` : sharedIp });
      cards.push({ account: id, value: `card_ring${r}_${k}` });
    }

    // Circular money flow in a tight time window, structured under $10k.
    const cycleStart = burstStart + 5 * DAY;
    for (let k = 0; k < size; k++) {
      const from = ringAccts[k].id;
      const to = ringAccts[(k + 1) % size].id;
      const tsMs = cycleStart + k * Math.floor(between(10 * 60_000, 40 * 60_000));
      txns.push({
        txnId: `txn_${ringId}_${k}`,
        from,
        to,
        amount: Math.round(between(9200, 9850) * 100) / 100, // structuring: just under $10k
        currency: 'USD',
        ts: new Date(tsMs).toISOString(),
        tsMs,
      });
    }

    // A little camouflage: ring accounts also send small legit-looking txns outward.
    for (let k = 0; k < size; k++) {
      const from = ringAccts[k].id;
      const to = pick(accounts).id;
      const tsMs = cycleStart + Math.floor(between(0, 3 * DAY));
      txns.push({
        txnId: `txn_${ringId}_noise_${k}`,
        from,
        to,
        amount: Math.round(between(10, 120) * 100) / 100,
        currency: 'USD',
        ts: new Date(tsMs).toISOString(),
        tsMs,
      });
    }
  }

  return { accounts, txns, devices, ips, cards };
}
