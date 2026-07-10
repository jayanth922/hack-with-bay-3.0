import { verifyConnectivity, closeDriver } from '../neo4j.js';
import { config } from '../config.js';
import { runInvestigation } from './pipeline.js';

// Local execution of the exact pipeline that gets deployed to RocketRide Cloud.
async function main() {
  config.requireNeo4j();
  await verifyConnectivity();

  const result = await runInvestigation({ mode: 'scan' });
  console.log(`Pipeline produced ${result.ringsFound} ring(s):\n`);
  for (const r of result.rings) {
    console.log(`  [${r.verdict.severity.toUpperCase()} ${r.verdict.score}] ${r.verdict.headline}`);
    console.log(`     accounts: ${r.evidence.ringAccounts.join(', ')}`);
    console.log(`     graph: ${r.graph.nodes.length} nodes / ${r.graph.edges.length} edges  (via ${r.verdict.source})\n`);
  }
  await closeDriver();
}

main().catch((e) => {
  console.error('✘ Pipeline failed:', e.message);
  process.exit(1);
});
