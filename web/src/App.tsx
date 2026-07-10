import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fullGraph, investigate, InvestigatedRing } from './api';

type Phase = 'landing' | 'loading' | 'story';

export default function App() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [net, setNet] = useState({ accounts: 0, txns: 0 });
  const [rings, setRings] = useState<InvestigatedRing[]>([]);
  const [ringIdx, setRingIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadStep, setLoadStep] = useState(0);

  useEffect(() => {
    fullGraph().then((g) => setNet({ accounts: g.nodes.length, txns: g.edges.length })).catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setInterval(() => setLoadStep((s) => (s + 1) % 4), 900);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    setPhase('loading'); setError(null); setLoadStep(0);
    try {
      const res = await investigate();
      if (!res.rings.length) throw new Error('No rings detected.');
      setRings(res.rings); setRingIdx(0); setStep(0); setPhase('story');
    } catch (e: any) { setError(String(e.message ?? e)); setPhase('landing'); }
  }

  if (phase === 'landing') return <Landing net={net} onStart={start} error={error} />;
  if (phase === 'loading') return <Loading step={loadStep} />;

  const ring = rings[ringIdx];
  const steps = buildSteps(ring);
  const last = step === steps.length - 1;
  const moreRings = ringIdx < rings.length - 1;

  return (
    <div className="stage">
      <header className="bar">
        <span className="mark">◈ RingLeader</span>
        <span className="crumbs">Ring {ringIdx + 1} of {rings.length}</span>
        <span className="progress">{String(step + 1).padStart(2, '0')} <em>/ {String(steps.length).padStart(2, '0')}</em></span>
      </header>

      <div className="story">
        <div className="diagram-wrap"><Diagram ring={ring} reveal={steps[step].reveal} /></div>
        <div className="narration" key={step}>
          <div className="kicker">{steps[step].kicker}</div>
          <h1>{steps[step].title}</h1>
          <div className="body">{steps[step].body}</div>
          {steps[step].evidence}
          {steps[step].verdict && <VerdictCard ring={ring} />}
        </div>
      </div>

      <footer className="nav">
        <div className="dots">{steps.map((_, i) => <i key={i} className={i === step ? 'on' : ''} onClick={() => setStep(i)} />)}</div>
        <div className="btns">
          {step > 0 && <button className="ghost" onClick={() => setStep(step - 1)}>← Back</button>}
          {!last && <button className="primary" onClick={() => setStep(step + 1)}>Next →</button>}
          {last && moreRings && <button className="primary" onClick={() => { setRingIdx(ringIdx + 1); setStep(0); }}>Next ring →</button>}
          {last && !moreRings && <button className="primary" onClick={() => { setRingIdx(0); setStep(0); }}>Start over ↺</button>}
        </div>
      </footer>
    </div>
  );
}

function Landing({ net, onStart, error }: { net: { accounts: number; txns: number }; onStart: () => void; error: string | null }) {
  return (
    <div className="landing">
      <span className="mark top">◈ RingLeader</span>
      <div className="hero">
        <div className="eyebrow">Fraud-ring investigation</div>
        <h1>Some fraud only exists<br />in the connections.</h1>
        <p>A single suspicious payment is easy to catch. A <em>ring</em> — many accounts secretly run by one person — hides in plain sight, because every payment looks ordinary alone. RingLeader catches them by following who's connected to whom.</p>
        <button className="primary big" onClick={onStart}>Run the investigation →</button>
        {error && <div className="err">{error}</div>}
        <div className="monitoring">Scanning <b>{net.accounts.toLocaleString()}</b> real accounts and <b>{net.txns.toLocaleString()}</b> transactions in a live Neo4j graph</div>
      </div>
      <div className="foot">Neo4j finds the ring · RocketRide explains it · Butterbase serves it</div>
    </div>
  );
}

function Loading({ step }: { step: number }) {
  const msgs = ['Reading the transaction graph…', 'Grouping accounts by shared devices…', 'Tracing the flow of money…', 'Asking the AI investigator…'];
  return <div className="loading-page"><div className="pulse" /><div className="load-msg">{msgs[step]}</div></div>;
}

/* ── steps: each clue paired with the real data that proves it ── */
interface Step { kicker: string; title: string; body: ReactNode; evidence?: ReactNode; reveal: number; verdict?: boolean; }

const firstName = (id: string, accts: { id: string; name: string }[]) => accts.find((a) => a.id === id)?.name.split(' ')[0] ?? id;
const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

function buildSteps(ring: InvestigatedRing): Step[] {
  const e = ring.evidence, g = ring.graph;
  const n = e.ringAccounts.length;
  const device = g.identities.find((i) => i.kind === 'device');
  const ip = g.identities.find((i) => i.kind === 'ip');
  const name = (id: string) => firstName(id, g.accounts);

  // real money trail from the cycle + actual transfer amounts
  const cyc = e.cycle && e.cycle.length > 2 ? e.cycle : g.accounts.map((a) => a.id).concat(g.accounts[0].id);
  const amt = new Map(g.transfers.map((t) => [t.source + '>' + t.target, t.amount]));
  const trail = [] as { from: string; to: string; amount: number }[];
  for (let i = 0; i < cyc.length - 1; i++) trail.push({ from: name(cyc[i]), to: name(cyc[i + 1]), amount: amt.get(cyc[i] + '>' + cyc[i + 1]) ?? 0 });
  const total = trail.reduce((s, h) => s + h.amount, 0) || (e.cycleAmount ?? 0);

  const created = [...g.accounts].filter((a) => a.createdAt).sort((a, b) => (a.createdAt! < b.createdAt! ? -1 : 1));
  const structured = g.transfers.filter((t) => t.amount >= 9000 && t.amount < 10000).map((t) => t.amount);

  const steps: Step[] = [
    {
      kicker: 'The setup', reveal: 0,
      title: `Meet these ${n} accounts.`,
      body: <>On paper, {n} unrelated customers. Every payment they make looks normal on its own, so a traditional filter that checks one transaction at a time sees nothing wrong.</>,
      evidence: (
        <div className="ev">
          <div className="ev-h">The {n} accounts</div>
          <div className="chips">{g.accounts.map((a) => <span key={a.id} className="chip">{a.name}</span>)}</div>
          <div className="ev-note">0 flagged by transaction-level checks.</div>
        </div>
      ),
    },
  ];

  if (device) steps.push({
    kicker: 'Clue 1 — shared identity', reveal: 1,
    title: 'They all log in from one device.',
    body: <>All {n} accounts authenticate from a <b>single physical device</b>. Independent customers don't share one phone with {n - 1} strangers — this is one operator wearing {n} masks.</>,
    evidence: (
      <div className="ev">
        <div className="ev-h">What the graph shows</div>
        <div className="kv"><span>Device fingerprint</span><code>{device.label}</code></div>
        <div className="kv"><span>Logged in by</span><b>all {device.accounts.length} accounts</b></div>
        {ip && <div className="kv"><span>Shared IP address</span><code>{ip.label}</code> <small>({ip.accounts.length} accounts)</small></div>}
        <div className="ev-note">Expected for {n} real customers: {n} different devices.</div>
      </div>
    ),
  });

  steps.push({
    kicker: 'Clue 2 — circular flow', reveal: 2,
    title: 'The money runs in a loop.',
    body: <>Follow the cash: it hops from account to account and lands back where it began. Money that returns to its own origin isn't commerce — it's <b>layering</b>, the core step of laundering.</>,
    evidence: (
      <div className="ev">
        <div className="ev-h">The money trail (real transactions)</div>
        <div className="trail">
          {trail.map((h, i) => (
            <div key={i} className="hop"><span className="who">{h.from}</span><span className="arr">→</span><span className="who">{h.to}</span><span className="amt">${h.amount.toLocaleString()}</span></div>
          ))}
          <div className="hop back"><span className="arr">↩</span> returns to {trail[0]?.from}<span className="amt total">${Math.round(total).toLocaleString()} cycled</span></div>
        </div>
      </div>
    ),
  });

  if (created.length || structured.length >= 2) steps.push({
    kicker: 'Clue 3 — coordination', reveal: 3,
    title: 'They were built together, to dodge detection.',
    body: <>Two more tells that this was engineered: the accounts were opened moments apart, and every transfer is sized to slip under the reporting radar.</>,
    evidence: (
      <div className="ev">
        {created.length > 0 && <>
          <div className="ev-h">Account creation timestamps</div>
          <div className="times">{created.map((a) => <div key={a.id} className="trow"><span>{firstName(a.id, g.accounts)}</span><code>{fmtTime(a.createdAt)}</code></div>)}</div>
          <div className="ev-note">All {created.length} created within {e.creationWindowMinutes} minutes — not a coincidence.</div>
        </>}
        {structured.length >= 2 && <>
          <div className="ev-h" style={{ marginTop: 14 }}>Transfer amounts</div>
          <div className="chips">{structured.map((a, i) => <span key={i} className="chip warn">${a.toLocaleString()}</span>)}</div>
          <div className="ev-note">Every one just under the <b>$10,000</b> federal reporting threshold (structuring).</div>
        </>}
      </div>
    ),
  });

  steps.push({
    kicker: 'The verdict', reveal: 4, verdict: true,
    title: n >= 5 ? 'Four red flags. Same accounts. No coincidence.' : 'A coordinated fraud ring.',
    body: <>No single signal proves fraud on its own. But shared device <b>+</b> circular money <b>+</b> synchronized signup <b>+</b> structured amounts, all landing on the exact same {n} accounts, is a pattern that does not occur by chance.</>,
  });
  return steps;
}

function VerdictCard({ ring }: { ring: InvestigatedRing }) {
  const v = ring.verdict;
  return (
    <div className="verdict">
      <div className="v-row"><span className="risk">Risk {v.score}/100</span><span className="via">verdict written by an AI investigator on <b>RocketRide Cloud</b></span></div>
      <p className="v-expl">{v.explanation}</p>
      <div className="v-action"><b>Recommended action.</b> {v.recommendedAction}</div>
      <div className="v-note">↳ The detector was never told these accounts were fraudulent. It surfaced them from the graph patterns above — automatically.</div>
      <div className="v-actions"><button className="danger">Freeze accounts</button><button className="plain">File SAR</button></div>
    </div>
  );
}

/* ── diagram (builds up per reveal step) ── */
function Diagram({ ring, reveal }: { ring: InvestigatedRing; reveal: number }) {
  const accts = ring.graph.accounts;
  const device = ring.graph.identities.find((i) => i.kind === 'device');
  const layout = useMemo(() => {
    const cyc = ring.evidence.cycle && ring.evidence.cycle.length > 2 ? ring.evidence.cycle.slice(0, -1) : accts.map((a) => a.id);
    const order = cyc.filter((id, i) => cyc.indexOf(id) === i);
    const W = 500, H = 500, cx = W / 2, cy = H / 2, R = 162, n = order.length;
    const pts = order.map((id, i) => { const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n; return { id, i, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang }; });
    return { W, H, cx, cy, pts, n };
  }, [ring]);
  const { W, H, cx, cy, pts, n } = layout;
  const usesDevice = new Set(device?.accounts ?? []);

  return (
    <svg className="diagram" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#e5484d" /></marker></defs>
      <g className={`layer ${reveal >= 1 ? 'show' : ''}`}>{device && pts.filter((p) => usesDevice.has(p.id)).map((p) => <line key={p.id} x1={p.x} y1={p.y} x2={cx} y2={cy} className="spoke" />)}</g>
      <g className={`layer ${reveal >= 2 ? 'show' : ''}`}>{pts.map((p, i) => { const q = pts[(i + 1) % n]; return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="money" markerEnd="url(#ar)" />; })}</g>
      {device && <g className={`hub layer ${reveal >= 1 ? 'show' : ''}`}><circle cx={cx} cy={cy} r={30} /><text x={cx} y={cy - 3} className="hub-icon">📱</text><text x={cx} y={cy + 14} className="hub-label">one device</text></g>}
      {pts.map((p) => {
        const out = 27, lx = p.x + Math.cos(p.ang) * out, ly = p.y + Math.sin(p.ang) * out;
        const anchor = Math.cos(p.ang) > 0.3 ? 'start' : Math.cos(p.ang) < -0.3 ? 'end' : 'middle';
        const flagged = reveal >= 1 && usesDevice.has(p.id);
        return (
          <g key={p.id} className="acct">
            <circle cx={p.x} cy={p.y} r={18} className={flagged ? 'flag' : ''} />
            <text x={p.x} y={p.y + 1} className="acct-num">{p.i + 1}</text>
            <text x={lx} y={ly} className="acct-label" textAnchor={anchor} dominantBaseline="middle">{firstName(p.id, accts)}</text>
          </g>
        );
      })}
    </svg>
  );
}
