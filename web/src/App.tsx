import { useEffect, useState } from 'react';
import { fullGraph, investigate, InvestigatedRing } from './api';

const sevColor: Record<string, string> = {
  critical: '#ff3b6b', high: '#ff7a45', medium: '#f5a524', low: '#7c8aa5',
};
const LOADING_STEPS = [
  'Querying Neo4j transaction graph…',
  'Clustering accounts by shared devices & IPs…',
  'Tracing circular money flows…',
  'Running RocketRide investigator…',
];

export default function App() {
  const [network, setNetwork] = useState({ accounts: 0, txns: 0 });
  const [rings, setRings] = useState<InvestigatedRing[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fullGraph()
      .then((g) => setNetwork({ accounts: g.nodes.length, txns: g.edges.length }))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 2200);
    return () => clearInterval(t);
  }, [loading]);

  async function runScan() {
    setLoading(true); setError(null);
    try {
      const res = await investigate();
      setRings(res.rings); setSelected(0); setScanned(true);
    } catch (e: any) { setError(String(e.message ?? e)); }
    finally { setLoading(false); }
  }

  const active = rings[selected];
  const flagged = rings.reduce((n, r) => n + r.evidence.ringAccounts.length, 0);
  const exposure = rings.reduce((n, r) => n + (r.evidence.totalFlow || 0), 0);

  return (
    <div className="console">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          <div><h1>RingLeader</h1><p>Fraud-ring investigation console</p></div>
        </div>
        <div className="stack"><b>Neo4j</b> finds the ring · <b>RocketRide</b> explains it · <b>Butterbase</b> serves it</div>
        <button className="scan-btn" onClick={runScan} disabled={loading}>
          {loading ? 'Investigating…' : scanned ? '↻ Re-run detection' : '⚡ Run detection'}
        </button>
      </header>

      <div className="statbar">
        <Stat label="Accounts monitored" value={network.accounts.toLocaleString()} />
        <Stat label="Transactions" value={network.txns.toLocaleString()} />
        <Stat label="Fraud rings found" value={scanned ? String(rings.length) : '—'} tone={rings.length ? 'danger' : ''} />
        <Stat label="Accounts flagged" value={scanned ? String(flagged) : '—'} tone={flagged ? 'danger' : ''} />
        <Stat label="Exposure" value={scanned ? '$' + Math.round(exposure).toLocaleString() : '—'} tone={exposure ? 'danger' : ''} />
      </div>

      {error && <div className="error">⚠ {error}</div>}

      <div className="workspace">
        <aside className="alerts">
          <div className="pane-head">Alert queue {scanned && <span className="count">{rings.length}</span>}</div>
          {!scanned && <div className="pane-empty">Run detection to surface coordinated fraud rings hiding in the network.</div>}
          {rings.map((r, i) => (
            <button key={i} className={`alert ${selected === i ? 'on' : ''}`} onClick={() => setSelected(i)}>
              <div className="alert-top">
                <span className="sev-pill" style={{ background: sevColor[r.verdict.severity] }}>{r.verdict.severity}</span>
                <span className="alert-id">RING-{String(i + 1).padStart(3, '0')}</span>
                <span className="alert-score">{r.verdict.score}</span>
              </div>
              <div className="alert-head">{r.evidence.ringAccounts.length} accounts · one operator</div>
              <div className="alert-meta">${Math.round(r.evidence.totalFlow).toLocaleString()} cycled · shares a device</div>
            </button>
          ))}
        </aside>

        <main className="canvas">
          {loading && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-step">{LOADING_STEPS[step]}</div>
              <div className="loading-sub">{step + 1} / {LOADING_STEPS.length}</div>
            </div>
          )}
          {!loading && !scanned && (
            <div className="canvas-empty">
              <div className="big">◈</div>
              <h2>Ready to investigate</h2>
              <p><b>{network.accounts.toLocaleString()} accounts</b> and <b>{network.txns.toLocaleString()} transactions</b> are being monitored.
                Every transaction looks normal on its own — click <b>Run detection</b> to reveal the rings hiding in the relationships.</p>
            </div>
          )}
          {!loading && scanned && active && <RingView ring={active} index={selected} />}
        </main>

        <aside className="case">
          {!active && <div className="pane-empty">Select an alert to open the investigation.</div>}
          {active && <CasePanel ring={active} />}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="stat"><div className={`stat-val ${tone ?? ''}`}>{value}</div><div className="stat-label">{label}</div></div>;
}

const firstName = (id: string, accounts: { id: string; name: string }[]) =>
  accounts.find((a) => a.id === id)?.name.split(' ')[0] ?? id;

function RingView({ ring, index }: { ring: InvestigatedRing; index: number }) {
  const e = ring.evidence;
  const accounts = ring.graph.accounts;
  const device = ring.graph.identities.find((i) => i.kind === 'device');
  const ip = ring.graph.identities.find((i) => i.kind === 'ip');

  // Order accounts by the money cycle so the loop reads cleanly around the circle.
  const cyc = e.cycle && e.cycle.length > 2 ? e.cycle.slice(0, -1) : accounts.map((a) => a.id);
  const order = cyc.filter((id, i) => cyc.indexOf(id) === i);

  const W = 720, H = 540, cx = W / 2, cy = H / 2, R = 165;
  const n = order.length;
  const pts = order.map((id, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { id, i, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang };
  });
  const byId = Object.fromEntries(pts.map((p) => [p.id, p]));
  const usesDevice = new Set(device?.accounts ?? []);

  const summary =
    `${n} accounts are being operated as a single fraud ring. ` +
    (device ? `They all sign in from the same device` : `They are tightly linked`) +
    (ip ? ` and IP address` : ``) +
    (e.creationWindowMinutes != null ? `, were created within ${e.creationWindowMinutes} minutes of each other,` : `,`) +
    ` and pass $${Math.round(e.cycleAmount ?? e.totalFlow).toLocaleString()} around in a closed loop that returns to the start.`;

  return (
    <div className="ringview">
      <div className="ring-summary">
        <span className="sev-pill" style={{ background: sevColor[ring.verdict.severity] }}>{ring.verdict.severity}</span>
        <span className="ring-title">RING-{String(index + 1).padStart(3, '0')}</span>
        <p>{summary}</p>
      </div>

      <svg className="ringsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#ff3b6b" />
          </marker>
        </defs>

        {/* spokes: every account -> the shared device hub (the smoking gun) */}
        {device && pts.filter((p) => usesDevice.has(p.id)).map((p) => (
          <line key={'sp' + p.id} x1={p.x} y1={p.y} x2={cx} y2={cy} className="spoke" />
        ))}

        {/* money cycle arrows around the ring */}
        {pts.map((p, i) => {
          const q = pts[(i + 1) % n];
          return <line key={'m' + i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="money" markerEnd="url(#arrow)" />;
        })}

        {/* center hub: shared device */}
        {device && (
          <g className="hub">
            <circle cx={cx} cy={cy} r={34} />
            <text x={cx} y={cy - 4} className="hub-icon">📱</text>
            <text x={cx} y={cy + 16} className="hub-label">shared device</text>
          </g>
        )}

        {/* account nodes + labels */}
        {pts.map((p) => {
          const out = 30;
          const lx = p.x + Math.cos(p.ang) * out, ly = p.y + Math.sin(p.ang) * out;
          const anchor = Math.cos(p.ang) > 0.25 ? 'start' : Math.cos(p.ang) < -0.25 ? 'end' : 'middle';
          return (
            <g key={p.id} className="acct">
              <title>{firstName(p.id, accounts)} — {p.id}</title>
              <circle cx={p.x} cy={p.y} r={20} />
              <text x={p.x} y={p.y + 1} className="acct-num">{p.i + 1}</text>
              <text x={lx} y={ly} className="acct-label" textAnchor={anchor} dominantBaseline="middle">
                {firstName(p.id, accounts)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="ring-annotations">
        <span><i className="dot dev" /> {n} accounts → 1 shared device{ip ? `, ${ip.accounts.length} also share IP ${ip.label}` : ''}</span>
        <span><i className="line cyc" /> ${Math.round(e.cycleAmount ?? 0).toLocaleString()} flows in a circle back to the start</span>
        {e.structuringCount >= 2 && <span><i className="dot warn" /> {e.structuringCount} transfers sized just under the $10K report limit</span>}
      </div>
    </div>
  );
}

function CasePanel({ ring }: { ring: InvestigatedRing }) {
  const v = ring.verdict, e = ring.evidence;
  return (
    <div className="casebody">
      <div className="case-band" style={{ background: sevColor[v.severity] }}>
        <span className="band-sev">{v.severity} risk</span>
        <span className="band-score">{v.score}<small>/100</small></span>
      </div>
      <div className="via">🤖 Verdict generated by the {v.source === 'rocketride' ? 'RocketRide Cloud pipeline' : v.source === 'ai' ? 'AI investigator' : 'rule engine'}</div>

      <div className="section-label">Investigator's verdict</div>
      <p className="case-explain">{v.explanation}</p>

      <div className="action-box">
        <div className="action-label">⚠ Recommended action</div>
        <p>{v.recommendedAction}</p>
        <div className="action-btns"><button className="freeze">Freeze accounts</button><button className="sar">File SAR</button></div>
      </div>

      <div className="section-label">Evidence the graph revealed</div>
      <ul className="evidence">
        {v.keyEvidence.map((k, i) => <li key={i}><span className="check">✓</span>{k}</li>)}
      </ul>

      <div className="section-label">By the numbers</div>
      <div className="mini-stats">
        <div><span>{e.ringAccounts.length}</span>accounts in ring</div>
        <div><span>${Math.round(e.totalFlow).toLocaleString()}</span>total flow</div>
        {e.creationWindowMinutes != null && <div><span>{e.creationWindowMinutes} min</span>signup window</div>}
        <div><span>{e.structuringCount}</span>sub-$10K transfers</div>
      </div>
    </div>
  );
}
