import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

export const config = {
  neo4j: {
    uri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    user: process.env.NEO4J_USER ?? 'neo4j',
    password: process.env.NEO4J_PASSWORD ?? 'password',
    database: process.env.NEO4J_DATABASE ?? 'neo4j',
  },
  ai: {
    baseURL: process.env.AI_GATEWAY_BASE_URL ?? 'https://api.butterbase.ai/v1',
    apiKey: process.env.AI_GATEWAY_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-3-5-sonnet',
  },
  rocketride: {
    endpoint: process.env.ROCKETRIDE_ENDPOINT ?? '',
    token: process.env.ROCKETRIDE_TOKEN ?? '',
  },
  port: Number(process.env.PORT ?? 8787),
  requireNeo4j() {
    required('NEO4J_URI');
    required('NEO4J_PASSWORD');
  },
};
