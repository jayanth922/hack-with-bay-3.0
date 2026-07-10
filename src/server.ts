import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { verifyConnectivity } from './neo4j.js';
import { scanRings } from './detection/detect.js';
import { subgraph, fullGraph, groundTruthRings } from './detection/queries.js';
import { investigate } from './agent/investigator.js';
import { runInvestigation } from './pipeline/pipeline.js';

// Local API server. In production the same routes are served by Butterbase
// serverless functions; the heavy investigation call is proxied to the
// RocketRide Cloud pipeline endpoint when configured.
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await verifyConnectivity();
    res.json({ ok: true, neo4j: true, ai: Boolean(config.ai.apiKey), rocketride: Boolean(config.rocketride.endpoint) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Fast, cheap: just the detector (no LLM) — powers the graph on first load.
app.get('/api/scan', async (req, res) => {
  try {
    const minScore = req.query.minScore ? Number(req.query.minScore) : 35;
    const rings = await scanRings(minScore);
    const withGraph = await Promise.all(
      rings.map(async (r) => ({ ...r, graph: await subgraph(r.ringAccounts) }))
    );
    res.json({ rings: withGraph });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Full investigation of the top ring (or a specific account) — detector + LLM.
// If RocketRide is configured, delegate to the deployed cloud pipeline.
app.post('/api/investigate', async (req, res) => {
  try {
    if (config.rocketride.endpoint && config.rocketride.token) {
      const r = await fetch(config.rocketride.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.rocketride.token}` },
        body: JSON.stringify(req.body ?? {}),
      });
      return res.status(r.status).json(await r.json());
    }
    const result = await runInvestigation(req.body ?? { mode: 'scan' });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/investigate/:accountId', async (req, res) => {
  try {
    const rings = await scanRings();
    const ring = rings.find((r) => r.ringAccounts.includes(req.params.accountId));
    if (!ring) return res.status(404).json({ error: 'No ring found for that account.' });
    const [verdict, graph] = await Promise.all([investigate(ring), subgraph(ring.ringAccounts)]);
    res.json({ evidence: ring, verdict, graph });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/graph', async (_req, res) => {
  try {
    res.json(await fullGraph());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ground-truth', async (_req, res) => {
  res.json({ rings: await groundTruthRings() });
});

app.listen(config.port, () => {
  console.log(`RingLeader API on http://localhost:${config.port}`);
  console.log(`  AI gateway: ${config.ai.apiKey ? 'configured' : 'template mode'} · RocketRide: ${config.rocketride.endpoint ? 'configured' : 'local'}`);
});
