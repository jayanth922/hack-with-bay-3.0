import 'dotenv/config';
import { RocketRideClient } from 'rocketride';

// Deploy + run the RingLeader investigator pipeline on RocketRide Cloud.
const PIPE = new URL('../../rocketride/investigator.pipe', import.meta.url).pathname;

const prompt = `You are RingLeader, an expert financial-crime investigator AI. Given the graph evidence below about a suspected fraud ring detected in a Neo4j transaction network, explain in plain English WHY these accounts form a fraud ring and what to do. Cite specific accounts, amounts, shared devices, timing. Emphasize what only the GRAPH reveals. Return STRICT JSON: {"headline":"<=90 chars","explanation":"2-4 sentences","recommendedAction":"1-2 sentences","keyEvidence":["3-5 short strings"]}.

Evidence:
${JSON.stringify({
  accounts: ['acc_ring1_0','acc_ring1_1','acc_ring1_2','acc_ring1_3','acc_ring1_4','acc_ring1_5','acc_ring1_6'],
  riskScore: 100,
  moneyCycle: ['acc_ring1_0','acc_ring1_1','acc_ring1_2','acc_ring1_3','acc_ring1_4','acc_ring1_5','acc_ring1_6','acc_ring1_0'],
  moneyCycleTotalUSD: 67326,
  sharedDevices: [{ fingerprint: 'dev_ring_1', accounts: 7 }],
  accountCreationWindowMinutes: 11,
  transfersJustUnder10kThreshold: 7,
}, null, 2)}`;

async function main() {
  const client = new RocketRideClient({
    auth: process.env.ROCKETRIDE_APIKEY!,
    uri: process.env.ROCKETRIDE_URI ?? 'https://api.rocketride.ai',
    env: {
      ROCKETRIDE_BB_KEY: process.env.AI_GATEWAY_API_KEY!,
      ROCKETRIDE_BB_BASE_URL: process.env.AI_GATEWAY_BASE_URL!,
      ROCKETRIDE_BB_MODEL: process.env.AI_MODEL!,
    },
    requestTimeout: 60000,
    onEvent: async (e: any) => { if (e?.event) console.log('  [event]', e.event, JSON.stringify(e.body ?? {}).slice(0, 120)); },
  });

  console.log('connecting to RocketRide Cloud…');
  await client.connect();
  console.log('✔ connected. deploying pipeline (use)…');
  const { token } = await client.use({ filepath: PIPE });
  console.log('✔ pipeline live, token:', token);
  console.log('sending evidence…');
  const result = await client.send(token, prompt, { name: 'evidence.txt' }, 'text/plain');
  console.log('\n===== RocketRide verdict =====\n', typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  await client.terminate(token);
  await client.disconnect();
}

main().catch((e) => { console.error('✘ RocketRide run failed:', e?.message ?? e); process.exit(1); });
