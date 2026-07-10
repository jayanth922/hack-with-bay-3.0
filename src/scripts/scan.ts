import { verifyConnectivity, closeDriver } from '../neo4j.js';
import { config } from '../config.js';
import { scanRings } from '../detection/detect.js';
import { groundTruthRings } from '../detection/queries.js';

async function main() {
  config.requireNeo4j();
  await verifyConnectivity();

  console.log('🔍 Scanning transaction graph for fraud rings…\n');
  const rings = await scanRings();

  if (!rings.length) {
    console.log('No rings above threshold. (Did you run `npm run seed`?)');
  }

  rings.forEach((r, i) => {
    console.log(`━━ Ring #${i + 1}  [${r.severity.toUpperCase()}]  score ${r.score}/100`);
    console.log(`   ${r.size} accounts: ${r.ringAccounts.join(', ')}`);
    r.signals.forEach((s) => console.log(`   • ${s}`));
    console.log('');
  });

  // Evaluation vs ground truth (planted rings) — proves the detector actually works.
  const truth = await groundTruthRings();
  console.log('── Evaluation vs planted ground truth ──');
  for (const t of truth) {
    const found = rings.find((r) => t.accounts.every((a) => r.ringAccounts.includes(a)));
    console.log(
      `   ${t.ringId} (${t.accounts.length} accts): ${found ? `✔ detected (score ${found.score})` : '✘ missed'}`
    );
  }

  await closeDriver();
}

main().catch((e) => {
  console.error('✘ Scan failed:', e.message);
  process.exit(1);
});
