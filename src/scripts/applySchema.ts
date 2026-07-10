import { run, verifyConnectivity, closeDriver } from '../neo4j.js';
import { config } from '../config.js';

// Constraints double as indexes on Aura Free (no GDS/APOC required).
const STATEMENTS = [
  'CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE',
  'CREATE CONSTRAINT device_fp IF NOT EXISTS FOR (d:Device) REQUIRE d.fingerprint IS UNIQUE',
  'CREATE CONSTRAINT ip_addr IF NOT EXISTS FOR (i:Ip) REQUIRE i.addr IS UNIQUE',
  'CREATE CONSTRAINT card_hash IF NOT EXISTS FOR (c:Card) REQUIRE c.hash IS UNIQUE',
  'CREATE INDEX account_created IF NOT EXISTS FOR (a:Account) ON (a.createdAtMs)',
];

async function main() {
  config.requireNeo4j();
  await verifyConnectivity();
  console.log('✔ Connected to Neo4j:', config.neo4j.uri);
  for (const stmt of STATEMENTS) {
    await run(stmt);
    console.log('  applied:', stmt.split(' IF NOT EXISTS')[0]);
  }
  console.log('✔ Schema applied.');
  await closeDriver();
}

main().catch((e) => {
  console.error('✘ Schema failed:', e.message);
  process.exit(1);
});
