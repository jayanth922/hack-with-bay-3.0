export interface Verdict {
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  headline: string;
  explanation: string;
  recommendedAction: string;
  keyEvidence: string[];
  source?: 'ai' | 'template' | 'rocketride';
}

export interface RingGraph {
  accounts: Array<{ id: string; name: string; country: string; createdAt?: string; planted?: boolean }>;
  transfers: Array<{ source: string; target: string; amount: number; ts: string }>;
  identities: Array<{ id: string; kind: 'device' | 'ip'; label: string; accounts: string[] }>;
}

export interface Evidence {
  ringAccounts: string[];
  score: number;
  severity: Verdict['severity'];
  signals: string[];
  cycle?: string[];
  cycleAmount?: number;
  totalFlow: number;
  creationWindowMinutes?: number;
  structuringCount: number;
  sharedDevices?: { fingerprint: string; accounts: string[] }[];
  sharedIps?: { addr: string; accounts: string[] }[];
}

export interface InvestigatedRing {
  evidence: Evidence;
  verdict: Verdict;
  graph: RingGraph;
}

// A ring whose data-driven evidence is ready but whose AI verdict may still be loading.
export interface RingCase {
  evidence: Evidence;
  verdict: Verdict | null;
  graph: RingGraph;
}

export interface NetworkGraph {
  nodes: Array<{ id: string; name: string; country: string; planted?: boolean }>;
  edges: Array<{ source: string; target: string; amount: number; ts: string }>;
}

const env = (import.meta as any).env ?? {};
const BASE: string = env.VITE_API_BASE ?? '';
const isFunction = BASE.includes('/fn/');
const APP_ID: string = env.VITE_APP_ID ?? '';
const AUTH_BASE = 'https://api.butterbase.ai/auth';
const DEMO_EMAIL: string = env.VITE_DEMO_EMAIL ?? '';
const DEMO_PASS: string = env.VITE_DEMO_PASS ?? '';

let token: string | null = null;

async function login(): Promise<string> {
  const r = await fetch(`${AUTH_BASE}/${APP_ID}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASS }),
  });
  if (!r.ok) throw new Error(`analyst login failed: ${r.status}`);
  token = (await r.json()).access_token;
  return token!;
}

async function authed(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isFunction) return fetch(url, init);
  if (!token) await login();
  const withAuth = (t: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
  });
  let r = await fetch(url, withAuth(token!));
  if (r.status === 401) {
    await login();
    r = await fetch(url, withAuth(token!));
  }
  return r;
}

export async function fullGraph(): Promise<NetworkGraph> {
  const r = await authed(isFunction ? `${BASE}?op=graph` : `${BASE}/api/graph`);
  if (!r.ok) throw new Error(`graph failed: ${r.status}`);
  return r.json();
}

// Fast: graph detection only (no LLM). Returns rings with evidence + graph so the
// walkthrough can render immediately.
export async function scan(): Promise<RingCase[]> {
  const r = await authed(isFunction ? `${BASE}?op=scan` : `${BASE}/api/scan`);
  if (!r.ok) throw new Error(`scan failed: ${r.status}`);
  const { rings } = await r.json();
  return (rings ?? []).map((fl: any) => ({ evidence: fl, verdict: null, graph: fl.graph }));
}

const ringKey = (accts: string[]) => [...accts].sort().join('|');

// Slower: runs the RocketRide Cloud investigator for every ring. Returns verdicts
// keyed by ring so they can be merged into the already-rendered cases.
export async function loadVerdicts(): Promise<Record<string, Verdict>> {
  const r = await authed(isFunction ? BASE : `${BASE}/api/investigate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'scan' }),
  });
  if (!r.ok) throw new Error(`verdicts failed: ${r.status}`);
  const { rings } = await r.json();
  const map: Record<string, Verdict> = {};
  for (const rr of rings ?? []) map[ringKey(rr.evidence.ringAccounts)] = rr.verdict;
  return map;
}

export { ringKey };
