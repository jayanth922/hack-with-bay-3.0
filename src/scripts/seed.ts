import { run, verifyConnectivity, closeDriver } from '../neo4j.js';
import { config } from '../config.js';
import { generate } from '../data/generate.js';

async function main() {
  config.requireNeo4j();
  await verifyConnectivity();
  const wipe = process.argv.includes('--wipe') || process.argv.includes('--reset');

  if (wipe) {
    console.log('… wiping existing graph');
    await run('MATCH (n) DETACH DELETE n');
  }

  const data = generate();
  console.log(
    `Generated: ${data.accounts.length} accounts, ${data.txns.length} txns, ` +
      `${new Set([...data.devices.map((d) => d.value)]).size} devices`
  );

  // Batched UNWIND writes keep us well within Aura Free limits.
  console.log('… loading accounts');
  await run(
    `UNWIND $rows AS row
     MERGE (a:Account {id: row.id})
     SET a.name = row.name, a.createdAt = row.createdAt,
         a.createdAtMs = row.createdAtMs, a.country = row.country,
         a.planted = row.planted, a.ringId = row.ringId`,
    { rows: data.accounts }
  );

  console.log('… loading device / ip / card links');
  await run(
    `UNWIND $rows AS row
     MATCH (a:Account {id: row.account})
     MERGE (d:Device {fingerprint: row.value})
     MERGE (a)-[:USED_DEVICE]->(d)`,
    { rows: data.devices }
  );
  await run(
    `UNWIND $rows AS row
     MATCH (a:Account {id: row.account})
     MERGE (i:Ip {addr: row.value})
     MERGE (a)-[:USED_IP]->(i)`,
    { rows: data.ips }
  );
  await run(
    `UNWIND $rows AS row
     MATCH (a:Account {id: row.account})
     MERGE (c:Card {hash: row.value})
     MERGE (a)-[:USED_CARD]->(c)`,
    { rows: data.cards }
  );

  console.log('… loading transactions (SENT edges)');
  // chunk transactions to keep transactions small
  const CHUNK = 500;
  for (let i = 0; i < data.txns.length; i += CHUNK) {
    const rows = data.txns.slice(i, i + CHUNK);
    await run(
      `UNWIND $rows AS row
       MATCH (f:Account {id: row.from})
       MATCH (t:Account {id: row.to})
       CREATE (f)-[:SENT {txnId: row.txnId, amount: row.amount,
               currency: row.currency, ts: row.ts, tsMs: row.tsMs}]->(t)`,
      { rows }
    );
  }

  const [{ nodes }] = await run<{ nodes: number }>('MATCH (n) RETURN count(n) AS nodes');
  const [{ rels }] = await run<{ rels: number }>('MATCH ()-[r]->() RETURN count(r) AS rels');
  console.log(`✔ Seeded. ${nodes} nodes, ${rels} relationships.`);
  console.log('  Ground-truth planted rings are tagged with a.ringId (for eval only).');
  await closeDriver();
}

main().catch((e) => {
  console.error('✘ Seed failed:', e.message);
  process.exit(1);
});
