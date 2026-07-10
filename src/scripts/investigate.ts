import { verifyConnectivity, closeDriver } from '../neo4j.js';
import { config } from '../config.js';
import { scanRings } from '../detection/detect.js';
import { investigate } from '../agent/investigator.js';
import { aiConfigured } from '../agent/gateway.js';

async function main() {
  config.requireNeo4j();
  await verifyConnectivity();

  const rings = await scanRings();
  if (!rings.length) {
    console.log('No rings found. Run `npm run seed` first.');
    await closeDriver();
    return;
  }

  console.log(`🤖 Investigator agent — AI gateway ${aiConfigured() ? 'LIVE' : 'not configured (template mode)'}\n`);
  const top = rings[0];
  const verdict = await investigate(top);

  console.log(`HEADLINE: ${verdict.headline}`);
  console.log(`SEVERITY: ${verdict.severity.toUpperCase()}  (score ${verdict.score}/100, via ${verdict.source})\n`);
  console.log(`EXPLANATION:\n${verdict.explanation}\n`);
  console.log(`RECOMMENDED ACTION:\n${verdict.recommendedAction}\n`);
  console.log('KEY EVIDENCE:');
  verdict.keyEvidence.forEach((e) => console.log(`  • ${e}`));

  await closeDriver();
}

main().catch((e) => {
  console.error('✘ Investigate failed:', e.message);
  process.exit(1);
});
