import 'dotenv/config';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { init, callTool, toolText } from './mcp.js';

const APP_ID = process.env.BB_APP_ID ?? 'app_6weti6gprado';
const DIST = new URL('../../web/dist', import.meta.url).pathname;
const ZIP = '/tmp/ringleader-site.zip';

async function main() {
  await init();
  // 1. build zip with forward slashes (never Compress-Archive)
  execSync(`cd ${DIST} && rm -f ${ZIP} && zip -r -X ${ZIP} . >/dev/null`);
  console.log('zipped', DIST);

  // 2. create deployment
  const dep = JSON.parse(toolText(await callTool('create_frontend_deployment', { app_id: APP_ID, framework: 'react-vite' })));
  console.log('deployment:', dep.deployment_id);

  // 3. upload zip to presigned URL
  const buf = readFileSync(ZIP);
  const up = await fetch(dep.uploadUrl, { method: 'PUT', body: buf });
  if (!up.ok) throw new Error(`upload failed: ${up.status}`);
  console.log('uploaded', buf.length, 'bytes');

  // 4. start deployment
  const start = JSON.parse(toolText(await callTool('manage_frontend', {
    app_id: APP_ID, action: 'start_deployment', deployment_id: dep.deployment_id,
  })));
  console.log('status:', start.status, '| url:', start.url);
}

main().catch((e) => { console.error('deployWeb failed:', e.message); process.exit(1); });
