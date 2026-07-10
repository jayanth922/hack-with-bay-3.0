import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { init, callTool, toolText } from './mcp.js';

const APP_ID = process.env.BB_APP_ID ?? 'app_6weti6gprado';

// Strip the TS type annotations that the Butterbase runtime doesn't need — it
// runs the code as-is; our handler is already plain enough, so we ship verbatim.
const code = readFileSync(new URL('../../butterbase/functions/api.ts', import.meta.url), 'utf8');

const dbId = new URL(process.env.NEO4J_URI!.replace('neo4j+s://', 'https://')).host.split('.')[0];
const queryUrl = `https://${dbId}.databases.neo4j.io/db/${process.env.NEO4J_DATABASE}/query/v2`;
const authB64 = Buffer.from(`${process.env.NEO4J_USER}:${process.env.NEO4J_PASSWORD}`).toString('base64');

// Inline the Butterbase gateway creds into the RocketRide pipeline (server-side only).
const rrPipe = readFileSync(new URL('../../rocketride/investigator.pipe', import.meta.url), 'utf8')
  .replace('${ROCKETRIDE_BB_MODEL}', process.env.AI_MODEL!)
  .replace('${ROCKETRIDE_BB_BASE_URL}', process.env.AI_GATEWAY_BASE_URL!)
  .replace('${ROCKETRIDE_BB_KEY}', process.env.AI_GATEWAY_API_KEY!);

async function main() {
  await init();
  const r = await callTool('deploy_function', {
    app_id: APP_ID,
    name: 'api',
    description: 'RingLeader fraud-ring detection + investigation API (Neo4j HTTP + AI gateway).',
    code,
    envVars: {
      NEO4J_QUERY_URL: queryUrl,
      NEO4J_AUTH_B64: authB64,
      AI_BASE_URL: process.env.AI_GATEWAY_BASE_URL!,
      AI_KEY: process.env.AI_GATEWAY_API_KEY!,
      AI_MODEL: process.env.AI_MODEL!,
      ROCKETRIDE_KEY: process.env.ROCKETRIDE_APIKEY!,
      ROCKETRIDE_BASE: process.env.ROCKETRIDE_URI ?? 'https://api.rocketride.ai',
      ROCKETRIDE_PIPE: rrPipe,
    },
    timeoutMs: 120000,
    memoryLimitMb: 256,
    trigger: { type: 'http', config: {} },
  });
  console.log(toolText(r));
}

main().catch((e) => {
  console.error('deploy failed:', e.message);
  process.exit(1);
});
