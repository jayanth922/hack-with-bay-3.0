import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fullGraph, investigate, InvestigatedRing } from './api';

const sevColor: Record<string, string> = {
  critical: '#ff3b6b', high: '#ff7a45', medium: '#f5a524', low: '#7c8aa5',
};
const LOADING_STEPS = [
  'Querying Neo4j transaction graph…',
  'Clustering by shared devices & IPs…',
  'Tracing circular money flows…',
  'Running RocketRide investigator…',
];

export default function App() {
  const [network, setNetwork] = useState<{ accounts: number; txns: number }>({ accounts: 0, txns: 0 });
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
    const t = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 2500);
    return () => clearInterval(t);
  }, [loading]);

  async function runScan() {
    setLoading(true); setError(null);
    try {
      const res = await investigate();
      setRings(res.rings);
      setSelected(0);
      setScanned(true);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const active = rings[selected];
  const flagged = rings.reduce((n, r) => n + r.evidence.ringAccounts.length, 0);
  const exposure = rings.reduce((n, r) => n + (r.evidence.totalFlow || 0), 0);

  return (
    <div className="console">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          <div>
            <h1>RingLeader</h1>
            <p>Fraud-ring investigation console</p>
          </div>
        </div>
        <div className="stack">Neo4j · RocketRide · Butterbase</div>
        <button className="scan-btn" onClick={runScan} disabled={loading}>
          {loading ? 'Investigating…' : scanned ? '↻ Re-run detection' : '⚡ Run detection'}
        </button>
      </header>

      <div className="statbar">
        <Stat label="Accounts monitored" value={network.accounts.toLocaleString()} />
        <Stat label="Transactions" value={network.txns.toLocaleString()} />
        <Stat label="Fraud rings" value={scanned ? String(rings.length) : '—'} tone={rings.length ? 'danger' : undefined} />
        <Stat label="Accounts flagged" value={scanned ? String(flagged) : '—'} tone={flagged ? 'danger' : undefined} />
        <Stat label="Exposure" value={scanned ? '$' + Math.round(exposure).toLocaleString() : '—'} tone={exposure ? 'danger' : undefined} />
      </div>

      {error && <div className="error">⚠ {error}</div>}

      <div className="workspace">
        {/* LEFT — alert queue */}
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
              <div className="alert-head">{r.verdict.headline}</div>
              <div className="alert-meta">
                {r.evidence.ringAccounts.length} accounts · ${Math.round(r.evidence.totalFlow).toLocaleString()} flow
              </div>
            </button>
          ))}
        </aside>

        {/* CENTER — link-analysis graph */}
        <main className="canvas">
          {loading && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-step">{LOADING_STEPS[step]}</div>
            </div>
          )}
          {!loading && !scanned && (
            <div className="canvas-empty">
              <div className="big">◈</div>
              <h2>Ready to investigate</h2>
              <p>{network.accounts.toLocaleString()} accounts and {network.txns.toLocaleString()} transactions are being monitored.
                Every transaction looks normal on its own — click <b>Run detection</b> to reveal the rings hiding in the relationships.</p>
            </div>
          )}
          {!loading && scanned && active && <RingGraph ring={active} key={selected} />}
        </main>

        {/* RIGHT — investigation / case panel */}
        <aside className="case">
          {!active && <div className="pane-empty">Select an alert to open the investigation.</div>}
          {active && <CasePanel ring={active} />}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stat">
      <div className={`stat-val ${tone ?? ''}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function shortName(id: string, name: string) {
  return name?.split(' ')[0] ?? id;
}

function RingGraph({ ring }: { ring: InvestigatedRing }) {
  const fgRef = useRef<any>(null);
  const data = useMemo(() => {
    const g = ring.graph;
    const cyc = ring.evidence.cycle ?? [];
    const cycleEdges = new Set<string>();
    for (let i = 0; i < cyc.length - 1; i++) cycleEdges.add(cyc[i] + '>' + cyc[i + 1]);
    const nodes = [
      ...g.accounts.map((a) => ({ id: a.id, kind: 'account', label: shortName(a.id, a.name) })),
      ...g.identities.map((idn) => ({ id: idn.id, kind: idn.kind, label: idn.label })),
    ];
    const links = [
      ...g.transfers.map((t) => ({ source: t.source, target: t.target, kind: 'money', amount: t.amount, cycle: cycleEdges.has(t.source + '>' + t.target) })),
      ...g.identities.flatMap((idn) => idn.accounts.map((a) => ({ source: a, target: idn.id, kind: 'shared' }))),
    ];
    return { nodes, links };
  }, [ring]);

  useEffect(() => { const t = setTimeout(() => fgRef.current?.zoomToFit(500, 70), 400); return () => clearTimeout(t); }, [data]);

  return (
    <>
      <div className="canvas-head">
        <span className="sev-pill" style={{ background: sevColor[ring.verdict.severity] }}>{ring.verdict.severity}</span>
        Link analysis — {ring.evidence.ringAccounts.length} accounts converging on {ring.graph.identities.length} shared {ring.graph.identities.length === 1 ? 'identifier' : 'identifiers'}
        <button className="fit-btn" onClick={() => fgRef.current?.zoomToFit(500, 70)}>Fit</button>
      </div>
      <ForceGraph2D
        ref={fgRef}
        graphData={data as any}
        backgroundColor="#0b0f1a"
        nodeRelSize={6}
        cooldownTicks={120}
        linkColor={(l: any) => (l.kind === 'money' ? (l.cycle ? '#ff3b6b' : 'rgba(245,165,36,0.55)') : 'rgba(124,138,165,0.35)')}
        linkWidth={(l: any) => (l.cycle ? 2.5 : 1)}
        linkLineDash={(l: any) => (l.kind === 'shared' ? [4, 4] : null)}
        linkDirectionalArrowLength={(l: any) => (l.kind === 'money' ? 4 : 0)}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={(l: any) => (l.cycle ? 4 : 0)}
        linkDirectionalParticleWidth={2.5}
        linkDirectionalParticleColor={() => '#ff3b6b'}
        nodeCanvasObject={(node: any, ctx, scale) => {
          const r = node.kind === 'account' ? 6 : 8;
          ctx.save();
          if (node.kind === 'device' || node.kind === 'ip') {
            // shared identity: the smoking gun — diamond (device) / square (ip)
            ctx.fillStyle = node.kind === 'device' ? '#ff3b6b' : '#a855f7';
            ctx.strokeStyle = '#0b0f1a'; ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (node.kind === 'device') { // diamond
              ctx.moveTo(node.x, node.y - r); ctx.lineTo(node.x + r, node.y);
              ctx.lineTo(node.x, node.y + r); ctx.lineTo(node.x - r, node.y); ctx.closePath();
            } else { // square
              ctx.rect(node.x - r, node.y - r, r * 2, r * 2);
            }
            ctx.fill(); ctx.stroke();
          } else {
            ctx.fillStyle = '#cbd5e1'; ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
          }
          const fs = Math.max(9, 11 / scale);
          ctx.font = `${fs}px -apple-system, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillStyle = node.kind === 'account' ? '#94a3b8' : (node.kind === 'device' ? '#ff8fa8' : '#c9a5f5');
          const label = node.kind === 'account' ? node.label : (node.kind === 'device' ? '📱 ' + node.label : '🌐 ' + node.label);
          ctx.fillText(label, node.x, node.y + r + 2);
          ctx.restore();
        }}
      />
      <div className="legend">
        <span><i className="dot acc" /> account</span>
        <span><i className="dot dev" /> shared device</span>
        <span><i className="dot ip" /> shared IP</span>
        <span><i className="line cyc" /> money cycle</span>
      </div>
    </>
  );
}

function CasePanel({ ring }: { ring: InvestigatedRing }) {
  const v = ring.verdict;
  const e = ring.evidence;
  return (
    <div className="casebody">
      <div className="case-band" style={{ background: sevColor[v.severity] }}>
        <span className="band-sev">{v.severity} risk</span>
        <span className="band-score">{v.score}<small>/100</small></span>
      </div>
      <div className="via">
        Verdict by {v.source === 'rocketride' ? 'RocketRide Cloud pipeline' : v.source === 'ai' ? 'AI investigator' : 'rule engine'}
      </div>

      <h2 className="case-head">{v.headline}</h2>
      <p className="case-explain">{v.explanation}</p>

      <div className="action-box">
        <div className="action-label">Recommended action</div>
        <p>{v.recommendedAction}</p>
        <div className="action-btns">
          <button className="freeze">Freeze accounts</button>
          <button className="sar">File SAR</button>
        </div>
      </div>

      <div className="section-label">Evidence</div>
      <ul className="evidence">
        {v.keyEvidence.map((k, i) => <li key={i}><span className="check">✓</span>{k}</li>)}
      </ul>

      <div className="section-label">Signals</div>
      <div className="mini-stats">
        <div><span>{e.ringAccounts.length}</span>accounts</div>
        <div><span>${Math.round(e.totalFlow).toLocaleString()}</span>total flow</div>
        {e.creationWindowMinutes != null && <div><span>{e.creationWindowMinutes}m</span>signup window</div>}
        <div><span>{e.structuringCount}</span>sub-$10k transfers</div>
      </div>
    </div>
  );
}
