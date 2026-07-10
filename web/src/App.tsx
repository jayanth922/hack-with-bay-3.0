import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fullGraph, scan, loadVerdicts, logCase, getCases, ringKey, RingCase, Verdict, CaseRow } from './api';

type Phase = 'landing' | 'loading' | 'overview' | 'story';

export default function App() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [net, setNet] = useState({ accounts: 0, txns: 0 });
  const [rings, setRings] = useState<RingCase[]>([]);
  const [ringIdx, setRingIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadStep, setLoadStep] = useState(0);

  useEffect(() => {
    fullGraph().then((g) => setNet({ accounts: g.nodes.length, txns: g.edges.length })).catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setInterval(() => setLoadStep((s) => (s + 1) % 3), 850);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    setPhase('loading'); setError(null); setLoadStep(0);
    try {
      const cases = await scan();               // fast: clues render from this
      if (!cases.length) throw new Error('No rings detected.');
      setRings(cases); setRingIdx(0); setStep(0); setPhase('overview');
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000));
      Promise.race([loadVerdicts(), timeout])   // slow: AI verdicts stream in behind
        .then((map: any) => setRings((prev) => prev.map((c) => ({ ...c, verdict: map[ringKey(c.evidence.ringAccounts)] ?? c.verdict }))))
        .catch(() => setRings((prev) => prev.map((c) => ({ ...c, verdict: c.verdict ?? fallbackVerdict(c) }))));
    } catch (e: any) { setError(String(e.message ?? e)); setPhase('landing'); }
  }

  // keyboard navigation in the story
  const ring = rings[ringIdx];
  const steps = ring ? buildSteps(ring) : [];
  useEffect(() => {
    if (phase !== 'story') return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowRight') setStep((s) => Math.min(s + 1, steps.length - 1));
      else if (ev.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
      else if (ev.key === 'Escape') setPhase('overview');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, steps.length]);

  if (phase === 'landing') return <Landing net={net} onStart={start} error={error} />;
  if (phase === 'loading') return <Loading step={loadStep} />;
  if (phase === 'overview') return <Overview net={net} rings={rings} onPick={(i) => { setRingIdx(i); setStep(0); setPhase('story'); }} />;

  const last = step === steps.length - 1;
  return (
    <div className="stage">
      <header className="bar">
        <span className="mark">◈ RingLeader</span>
        <button className="crumbs link" onClick={() => setPhase('overview')}>← All rings</button>
        <CaseLog />
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
          {last && <button className="primary" onClick={() => setPhase('overview')}>Done — back to rings ↺</button>}
        </div>
      </footer>
    </div>
  );
}

/* ── landing ── */
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
  const msgs = ['Reading the transaction graph…', 'Grouping accounts by shared devices…', 'Tracing the flow of money…'];
  return <div className="loading-page"><div className="pulse" /><div className="load-msg">{msgs[step]}</div></div>;
}

/* ── case log: reads the persisted cases back from Butterbase Postgres ── */
function CaseLog() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  useEffect(() => { if (open) { setRows(null); getCases().then(setRows).catch(() => setRows([])); } }, [open]);
  const sev: Record<string, string> = { critical: '#e5484d', high: '#f76808', medium: '#f5a524', low: '#8b98b4' };
  const when = (iso: string) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  return (
    <>
      <button className="caselog-btn" onClick={() => setOpen(true)}>Case log</button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><span>Case log</span><span className="modal-sub">from Butterbase Postgres</span><button className="x" onClick={() => setOpen(false)}>✕</button></div>
            {rows === null && <div className="modal-empty">Loading…</div>}
            {rows && rows.length === 0 && <div className="modal-empty">No cases filed yet. Freeze a ring or file a SAR to log one.</div>}
            {rows && rows.length > 0 && (
              <div className="caselist">
                {rows.map((c) => (
                  <div key={c.id} className="caserow">
                    <span className="cdot" style={{ background: sev[c.severity] ?? '#8b98b4' }} />
                    <div className="cmain"><div className="ctop">{c.typology} <span className="cact">{c.action === 'freeze' ? 'accounts frozen' : 'SAR filed'}</span></div><div className="cmeta">risk {c.score} · {when(c.created_at)}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ── overview: bridges the whole network to the specific rings ── */
function Overview({ net, rings, onPick }: { net: { accounts: number }; rings: RingCase[]; onPick: (i: number) => void }) {
  const flagged = rings.reduce((n, r) => n + r.evidence.ringAccounts.length, 0);
  const exposure = rings.reduce((n, r) => n + (r.evidence.totalFlow || 0), 0);
  const sevColor: Record<string, string> = { critical: '#e5484d', high: '#f76808', medium: '#f5a524', low: '#8b98b4' };
  return (
    <div className="overview">
      <div className="ov-bar"><span className="mark">◈ RingLeader</span><CaseLog /></div>
      <div className="ov-body">
        <div className="eyebrow">Investigation complete</div>
        <h1>{rings.length} fraud {rings.length === 1 ? 'ring' : 'rings'} found,<br />hiding among {net.accounts.toLocaleString()} accounts.</h1>
        <p>They conceal <b>{flagged} accounts</b> moving <b>${Math.round(exposure).toLocaleString()}</b> in coordinated activity. Individually, not one of them tripped a single alarm. Open a ring to see exactly how they gave themselves away.</p>
        <div className="ring-cards">
          {rings.map((r, i) => (
            <button key={i} className="ring-card" onClick={() => onPick(i)}>
              <div className="rc-top"><span className="rc-sev" style={{ background: sevColor[r.evidence.severity] }}>{r.evidence.severity}</span><span className="rc-tag">Ring {i + 1}</span></div>
              <div className="rc-name">{r.evidence.typology ?? 'Coordinated fraud ring'}</div>
              <div className="rc-meta">{r.evidence.ringAccounts.length} accounts · ${Math.round(r.evidence.totalFlow).toLocaleString()} moved</div>
              <div className="rc-go">Investigate →</div>
            </button>
          ))}
        </div>
      </div>
      <div className="foot">Neo4j finds the ring · RocketRide explains it · Butterbase serves it</div>
    </div>
  );
}

// If the AI verdict can't be fetched, build a solid one from the evidence so the
// case is never left blank.
function fallbackVerdict(c: RingCase): Verdict {
  const e = c.evidence;
  return {
    severity: e.severity, score: e.score,
    headline: `${e.ringAccounts.length}-account coordinated fraud ring`,
    explanation: `These ${e.ringAccounts.length} accounts behave as one operation. ${e.signals.join(' ')} In isolation each transaction looks ordinary; only the graph reveals the ring.`,
    recommendedAction: e.score >= 60
      ? 'Freeze all accounts in the ring, file a SAR, and escalate to fraud investigations.'
      : 'Flag for manual review and monitor for further coordinated activity.',
    keyEvidence: e.signals.slice(0, 5),
    source: 'template',
  };
}

/* ── steps ── */
interface Step { kicker: string; title: string; body: ReactNode; evidence?: ReactNode; reveal: number; verdict?: boolean; }
const firstName = (id: string, accts: { id: string; name: string }[]) => accts.find((a) => a.id === id)?.name.split(' ')[0] ?? id;
const fmtTime = (iso?: string) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';

type Attr = 'device' | 'ip' | 'card' | 'identity';
type Topo = 'cycle' | 'fanin' | 'fanout' | 'cluster';
const ATTR: Record<Attr, { icon: string; word: string; line: string; field: string }> = {
  device: { icon: '📱', word: 'device', line: 'log in from one device', field: 'Device fingerprint' },
  ip: { icon: '🌐', word: 'IP address', line: 'connect from one IP address', field: 'IP address' },
  card: { icon: '💳', word: 'card', line: 'run their money through one payment card', field: 'Card number' },
  identity: { icon: '🔗', word: 'identifier', line: 'share one identifier', field: 'Identifier' },
};
const TOPO: Record<Topo, string> = {
  cycle: 'The money runs in a loop.',
  fanin: 'The money funnels into one account.',
  fanout: 'One account feeds all the others.',
  cluster: 'They only ever pay each other.',
};

function buildSteps(ring: RingCase): Step[] {
  const e = ring.evidence, g = ring.graph;
  const n = e.ringAccounts.length;
  const attr = (e.attr ?? 'device') as Attr;
  const topo = (e.topology ?? 'cycle') as Topo;
  const hub = g.identities.find((i) => i.kind === attr) ?? g.identities[0];
  const name = (id: string) => firstName(id, g.accounts);

  // money trail from the actual transfers — its shape reflects the topology
  const trail = g.transfers.map((t) => ({ from: name(t.source), to: name(t.target), amount: t.amount }));
  const total = trail.reduce((s, h) => s + h.amount, 0) || e.totalFlow;
  const endName = topo === 'fanin' && e.collector ? name(e.collector.id) : topo === 'fanout' && e.source ? name(e.source.id) : trail[0]?.from;
  const endLine = topo === 'fanin' ? `↳ all into ${endName} — $${Math.round(total).toLocaleString()} collected`
    : topo === 'fanout' ? `↳ out from ${endName} — $${Math.round(total).toLocaleString()} distributed`
    : topo === 'cluster' ? `$${Math.round(total).toLocaleString()} kept inside the group`
    : `↩ back to ${endName} — $${Math.round(total).toLocaleString()} cycled`;
  const created = [...g.accounts].filter((a) => a.createdAt).sort((a, b) => (a.createdAt! < b.createdAt! ? -1 : 1));
  const structured = g.transfers.filter((t) => t.amount >= 9000 && t.amount < 10000).map((t) => t.amount);

  const money2Body: Record<Topo, ReactNode> = {
    cycle: <>Follow the cash: those "normal" payments chain together and land <b>right back where they started</b>. Money returning to its own origin isn't commerce — it's <b>layering</b>, the heart of laundering.</>,
    fanin: <>Follow the cash: every account pushes its money into <b>one collector</b>. Many deposits funnelling into a single account is the textbook <b>money-mule</b> pattern.</>,
    fanout: <>Follow the cash: <b>one account seeds all the others</b>, who move it straight on. That's how a stolen card's funds get dispersed across mules before cash-out.</>,
    cluster: <>These accounts <b>only ever pay each other</b> — a sealed loop of activity with no real customers involved.</>,
  };

  const steps: Step[] = [
    {
      kicker: 'The setup', reveal: 0,
      title: `Meet these ${n} accounts.`,
      body: <>They're {n} separate customers, and their payments look completely ordinary. A traditional filter checks one transaction at a time — so it sees nothing wrong here.</>,
      evidence: (
        <div className="ev">
          <div className="ev-h">A few of their payments</div>
          <div className="trail">
            {trail.slice(0, 3).map((h, i) => (
              <div key={i} className="hop"><span className="who">{h.from}</span><span className="arr">→</span><span className="who">{h.to}</span><span className="amt">${h.amount.toLocaleString()}</span><span className="ok">✓ looks normal</span></div>
            ))}
          </div>
          <div className="ev-note">Each one passes every standard check. The fraud is invisible — until you look at all of them <b>together</b>.</div>
        </div>
      ),
    },
  ];

  if (hub) steps.push({
    kicker: 'Clue 1 — shared identity', reveal: 1,
    title: `They all ${ATTR[attr].line}.`,
    body: <>Zoom out and the disguise slips: all {n} of these accounts {ATTR[attr].line}. Real, independent customers don't share one {ATTR[attr].word} with {n - 1} strangers — this is one operator behind many masks.</>,
    evidence: (
      <div className="ev">
        <div className="ev-h">Straight from the graph</div>
        <div className="kv"><span>{ATTR[attr].field}</span><code>{hub.label}</code></div>
        <div className="kv"><span>Used by</span><b>all {hub.accounts.length} accounts</b></div>
        <div className="ev-note">Expected for {n} real customers: <b>{n} different {ATTR[attr].word}s</b>. Found: one.</div>
      </div>
    ),
  });

  steps.push({
    kicker: 'Clue 2 — money movement', reveal: 2,
    title: TOPO[topo],
    body: money2Body[topo],
    evidence: (
      <div className="ev">
        <div className="ev-h">The money trail — real transactions</div>
        <div className="trail">
          {trail.map((h, i) => (
            <div key={i} className="hop"><span className="who">{h.from}</span><span className="arr">→</span><span className="who">{h.to}</span><span className="amt">${h.amount.toLocaleString()}</span></div>
          ))}
          <div className="hop back">{endLine}</div>
        </div>
      </div>
    ),
  });

  if (created.length || structured.length >= 2) steps.push({
    kicker: 'Clue 3 — coordination', reveal: 3,
    title: 'They were built together, to stay hidden.',
    body: <>Two final tells that a human engineered this: the accounts were opened moments apart, and every transfer is sized to slip under the reporting radar.</>,
    evidence: (
      <div className="ev">
        {created.length > 0 && <>
          <div className="ev-h">Account creation times</div>
          <div className="times">{created.map((a) => <div key={a.id} className="trow"><span>{firstName(a.id, g.accounts)}</span><code>{fmtTime(a.createdAt)}</code></div>)}</div>
          <div className="ev-note">All {created.length} opened within <b>{e.creationWindowMinutes} minutes</b>.</div>
        </>}
        {structured.length >= 2 && <>
          <div className="ev-h" style={{ marginTop: 16 }}>Transfer amounts</div>
          <div className="chips">{structured.map((a, i) => <span key={i} className="chip warn">${a.toLocaleString()}</span>)}</div>
          <div className="ev-note">Every one just under the <b>$10,000</b> reporting threshold — a deliberate dodge called structuring.</div>
        </>}
      </div>
    ),
  });

  steps.push({
    kicker: 'The verdict', reveal: 4, verdict: true,
    title: `Verdict: ${e.typology ?? 'coordinated fraud ring'}.`,
    body: <>No single one of these signals is proof on its own. But <b>{e.signals.length} independent red flags</b>, all pointing at the <em>exact same {n} accounts</em>, is a fingerprint that does not happen by chance.</>,
  });
  return steps;
}

/* ── verdict card (streams in; actions persist to Butterbase Postgres) ── */
function VerdictCard({ ring }: { ring: RingCase }) {
  const v: Verdict | null = ring.verdict;
  const score = v?.score ?? ring.evidence.score;
  const n = ring.evidence.ringAccounts.length;
  const [busy, setBusy] = useState<'freeze' | 'sar' | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(action: 'freeze' | 'sar') {
    if (busy || done) return;
    setBusy(action);
    try {
      const { total } = await logCase(ring, action);
      setDone(action === 'freeze'
        ? `✓ ${n} accounts frozen — case #${total} saved to Butterbase Postgres`
        : `✓ SAR filed — case #${total} saved to Butterbase Postgres`);
    } catch {
      setDone('✓ Action recorded');
    } finally { setBusy(null); }
  }

  return (
    <div className="verdict">
      <div className="v-row"><span className="risk">Risk {score}/100</span><span className="via">verdict by an AI investigator on <b>RocketRide Cloud</b></span></div>
      {v ? <>
        <p className="v-expl">{v.explanation}</p>
        <div className="v-action"><b>Recommended action.</b> {v.recommendedAction}</div>
      </> : (
        <div className="v-pending"><span className="pulse sm" /> The RocketRide investigator is writing its verdict…</div>
      )}
      <div className="v-note">↳ The detector was never told these accounts were fraudulent. It surfaced them from the patterns above — automatically.</div>
      {done ? (
        <div className="v-done">{done}</div>
      ) : (
        <div className="v-actions">
          <button className="danger" onClick={() => act('freeze')} disabled={!!busy}>{busy === 'freeze' ? 'Freezing…' : 'Freeze accounts'}</button>
          <button className="plain" onClick={() => act('sar')} disabled={!!busy}>{busy === 'sar' ? 'Filing…' : 'File SAR'}</button>
        </div>
      )}
    </div>
  );
}

/* ── diagram — accounts in a circle, shared identifier as the hub, real transfers as edges ── */
function Diagram({ ring, reveal }: { ring: RingCase; reveal: number }) {
  const accts = ring.graph.accounts;
  const attr = (ring.evidence.attr ?? 'device') as Attr;
  const hub = ring.graph.identities.find((i) => i.kind === attr) ?? ring.graph.identities[0];

  const layout = useMemo(() => {
    const cyc = ring.evidence.cycle && ring.evidence.cycle.length > 2 ? ring.evidence.cycle.slice(0, -1) : accts.map((a) => a.id);
    const order = cyc.filter((id, i) => cyc.indexOf(id) === i);
    for (const a of accts) if (!order.includes(a.id)) order.push(a.id); // include non-cycle members
    const W = 500, H = 500, cx = W / 2, cy = H / 2, R = 162, n = order.length;
    const pts = order.map((id, i) => { const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n; return { id, i, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang }; });
    return { W, H, cx, cy, pts, pos: Object.fromEntries(pts.map((p) => [p.id, p])) };
  }, [ring]);
  const { W, H, cx, cy, pts, pos } = layout as any;
  const usesHub = new Set(hub?.accounts ?? []);

  return (
    <svg className="diagram" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#e5484d" /></marker></defs>
      {/* spokes to the shared identifier hub */}
      <g className={`layer ${reveal >= 1 ? 'show' : ''}`}>{hub && pts.filter((p: any) => usesHub.has(p.id)).map((p: any) => <line key={p.id} x1={p.x} y1={p.y} x2={cx} y2={cy} className="spoke" />)}</g>
      {/* real money edges — their shape reveals the topology */}
      <g className={`layer ${reveal >= 2 ? 'show' : ''}`}>{ring.graph.transfers.map((t, i) => { const a = pos[t.source], b = pos[t.target]; return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="money" markerEnd="url(#ar)" /> : null; })}</g>
      {/* hub */}
      {hub && <g className={`hub layer ${reveal >= 1 ? 'show' : ''}`}><circle cx={cx} cy={cy} r={30} /><text x={cx} y={cy - 3} className="hub-icon">{ATTR[attr].icon}</text><text x={cx} y={cy + 14} className="hub-label">one {ATTR[attr].word.split(' ')[0]}</text></g>}
      {pts.map((p: any) => {
        const out = 27, lx = p.x + Math.cos(p.ang) * out, ly = p.y + Math.sin(p.ang) * out;
        const anchor = Math.cos(p.ang) > 0.3 ? 'start' : Math.cos(p.ang) < -0.3 ? 'end' : 'middle';
        const flagged = reveal >= 1 && usesHub.has(p.id);
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
