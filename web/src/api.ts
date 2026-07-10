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
  accounts: Array<{ id: string; name: string; country: string; planted?: boolean }>;
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

export async function investigate(): Promise<{ rings: InvestigatedRing[]; ringsFound: number }> {
  const r = await authed(isFunction ? BASE : `${BASE}/api/investigate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'scan' }),
  });
  if (!r.ok) throw new Error(`investigate failed: ${r.status}`);
  return r.json();
}
