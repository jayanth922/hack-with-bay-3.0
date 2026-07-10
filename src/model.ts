// ─── Domain model for the RingLeader property graph ───
// Nodes: Account, Device, Ip, Card
// Edges: SENT (money), USED_DEVICE, USED_IP, USED_CARD

export interface Account {
  id: string;
  name: string;
  createdAt: string; // ISO
  createdAtMs: number;
  country: string;
  planted: boolean; // true if part of a seeded fraud ring (ground truth, for eval only)
  ringId?: string;
}

export interface Txn {
  txnId: string;
  from: string; // account id
  to: string; // account id
  amount: number;
  currency: string;
  ts: string; // ISO
  tsMs: number;
}

export interface Link {
  account: string; // account id
  value: string; // device fingerprint / ip / card hash
}

export interface GraphData {
  accounts: Account[];
  txns: Txn[];
  devices: Link[];
  ips: Link[];
  cards: Link[];
}

// ─── Detection output ───

export interface RingEvidence {
  ringAccounts: string[];
  size: number;
  cycle?: string[]; // ordered account ids forming a money cycle
  cycleAmount?: number;
  sharedDevices: { fingerprint: string; accounts: string[] }[];
  sharedIps: { addr: string; accounts: string[] }[];
  sharedCards: { hash: string; accounts: string[] }[];
  creationWindowMinutes?: number;
  totalFlow: number;
  structuringCount: number; // txns just under a reporting threshold
  signals: string[];
  score: number; // 0-100
}

export interface Verdict {
  ringAccounts: string[];
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  headline: string;
  explanation: string;
  recommendedAction: string;
  keyEvidence: string[];
}
