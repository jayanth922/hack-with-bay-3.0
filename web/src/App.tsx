import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { fullGraph, investigate, InvestigatedRing, RingGraph } from './api';

type GNode = { id: string; name: string; country: string; planted?: boolean; ring?: number };
type GLink = { source: string; target: string; amount: number; inRing?: boolean };

const RING_COLORS = ['#ff3b6b', '#ffab00', '#8b5cf6', '#22d3ee'];
const sevColor: Record<string, string> = { critical: '#ff3b6b', high: '#ff7a45', medium: '#ffab00', low: '#9ca3af' };

export default function App() {
  const fgRef = useRef<any>(null);
  const [graph, setGraph] = useState<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const [rings, setRings] = useState<InvestigatedRing[]>([]);
  const [ringMembership, setRingMembership] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fullGraph()
      .then((g: RingGraph) => setGraph(toForce(g)))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  async function runScan() {
    setLoading(true);
    setError(null);
    try {
      const res = await investigate();
      const membership: Record<string, number> = {};
      res.rings.forEach((r, i) => r.evidence.ringAccounts.forEach((a) => (membership[a] = i)));
      setRingMembership(membership);
      setRings(res.rings);
      setScanned(true);
      setSelected(res.rings.length ? 0 : null);
      // re-tag existing graph nodes/links with ring membership + zoom to fit
      setGraph((g) => ({
        nodes: g.nodes.map((n) => ({ ...n, ring: membership[n.id] })),
        links: g.links.map((l) => ({
          ...l,
          inRing:
            membership[srcId(l.source)] !== undefined &&
            membership[srcId(l.source)] === membership[srcId(l.target)],
        })),
      }));
      setTimeout(() => fgRef.current?.zoomToFit(600, 60), 400);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const active = selected != null ? rings[selected] : null;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◈</span>
          <div>
            <h1>RingLeader</h1>
            <p>Agentic fraud-ring detective · Neo4j × RocketRide × Butterbase</p>
          </div>
        </div>
        <button className="scan-btn" onClick={runScan} disabled={loading}>
          {loading ? 'Investigating…' : scanned ? '↻ Re-scan network' : '⚡ Scan for fraud rings'}
        </button>
      </header>

      {error && <div className="error">⚠ {error} — is the API running? (`npm run server`)</div>}

      <div className="body">
        <div className="graph-pane">
          <ForceGraph2D
            ref={fgRef}
            graphData={graph as any}
            backgroundColor="#0b0f1a"
            nodeRelSize={4}
            nodeLabel={(n: any) => `${n.name} (${n.id})${n.ring !== undefined ? ' · RING' : ''}`}
            nodeColor={(n: any) => (n.ring !== undefined ? RING_COLORS[n.ring % RING_COLORS.length] : '#2b3550')}
            nodeVal={(n: any) => (n.ring !== undefined ? 6 : 1.5)}
            linkColor={(l: any) => (l.inRing ? '#ff3b6b' : 'rgba(120,140,180,0.12)')}
            linkWidth={(l: any) => (l.inRing ? 2 : 0.5)}
            linkDirectionalParticles={(l: any) => (l.inRing ? 4 : 0)}
            linkDirectionalParticleWidth={2}
            onNodeClick={(n: any) => {
              if (n.ring !== undefined) setSelected(n.ring);
            }}
            cooldownTicks={100}
          />
          <div className="legend">
            <span><i style={{ background: '#2b3550' }} /> normal account</span>
            <span><i style={{ background: '#ff3b6b' }} /> fraud ring</span>
            <span>{graph.nodes.length} accounts · {graph.links.length} transactions</span>
          </div>
        </div>

        <aside className="panel">
          {!scanned && (
            <div className="empty">
              <h2>The network looks fine.</h2>
              <p>
                {graph.nodes.length} accounts, thousands of transactions. Every payment looks
                ordinary in isolation. Hit <b>Scan</b> and let the agent surface the rings hiding in
                the <i>relationships</i>.
              </p>
              <div className="pipeline-note">
                Neo4j graph detection → RocketRide pipeline → LLM investigator
              </div>
            </div>
          )}

          {scanned && !rings.length && <div className="empty"><h2>No rings above threshold.</h2></div>}

          {scanned && rings.length > 0 && (
            <>
              <div className="ring-tabs">
                {rings.map((r, i) => (
                  <button
                    key={i}
                    className={`tab ${selected === i ? 'on' : ''}`}
                    style={{ borderColor: sevColor[r.verdict.severity] }}
                    onClick={() => setSelected(i)}
                  >
                    <span className="dot" style={{ background: sevColor[r.verdict.severity] }} />
                    Ring {i + 1} · {r.verdict.score}
                  </button>
                ))}
              </div>

              {active && (
                <div className="verdict">
                  <div className="sev" style={{ background: sevColor[active.verdict.severity] }}>
                    {active.verdict.severity.toUpperCase()} · {active.verdict.score}/100
                    {active.verdict.source === 'ai' && <span className="ai-badge">AI</span>}
                  </div>
                  <h2>{active.verdict.headline}</h2>
                  <p className="explanation">{active.verdict.explanation}</p>

                  <div className="action">
                    <b>Recommended action</b>
                    <p>{active.verdict.recommendedAction}</p>
                  </div>

                  <div className="evidence">
                    <b>Graph evidence</b>
                    <ul>
                      {active.verdict.keyEvidence.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="stats">
                    <div><span>{active.evidence.ringAccounts.length}</span>accounts</div>
                    <div><span>${Math.round(active.evidence.totalFlow).toLocaleString()}</span>total flow</div>
                    {active.evidence.creationWindowMinutes != null && (
                      <div><span>{active.evidence.creationWindowMinutes}m</span>signup window</div>
                    )}
                    <div><span>{active.evidence.structuringCount}</span>sub-$10k transfers</div>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function srcId(x: any): string {
  return typeof x === 'object' ? x.id : x;
}

function toForce(g: RingGraph): { nodes: GNode[]; links: GLink[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, name: n.name, country: n.country, planted: n.planted })),
    links: g.edges.map((e) => ({ source: e.source, target: e.target, amount: e.amount })),
  };
}
