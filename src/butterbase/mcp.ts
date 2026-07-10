import 'dotenv/config';

// Minimal MCP (Streamable HTTP) client so we can drive Butterbase deploy/submit
// tools directly with the account-scoped bb_sk key — no editor/session restart needed.

const MCP_URL = process.env.BUTTERBASE_MCP_URL ?? 'https://api.butterbase.ai/mcp';
const KEY = process.env.AI_GATEWAY_API_KEY ?? process.env.BUTTERBASE_KEY ?? '';

let sessionId: string | null = null;
let nextId = 1;

function parseBody(text: string): any {
  // Responses may be JSON or SSE ("event: message\ndata: {...}")
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const lines = trimmed.split('\n');
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data && data !== '[DONE]') return JSON.parse(data);
    }
  }
  throw new Error('Unparseable MCP response: ' + trimmed.slice(0, 200));
}

async function rpc(method: string, params?: any, isNotification = false): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const body: any = { jsonrpc: '2.0', method };
  if (!isNotification) body.id = nextId++;
  if (params) body.params = params;

  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (isNotification) return null;
  const text = await res.text();
  const json = parseBody(text);
  if (json.error) throw new Error(`MCP ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

export async function init(): Promise<any> {
  const result = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ringleader', version: '1.0' },
  });
  await rpc('notifications/initialized', {}, true);
  return result;
}

export async function listTools(): Promise<Array<{ name: string; description?: string }>> {
  const result = await rpc('tools/list');
  return result.tools ?? [];
}

export async function callTool(name: string, args: Record<string, any> = {}): Promise<any> {
  return rpc('tools/call', { name, arguments: args });
}

// Pretty-print a tool result's text content.
export function toolText(result: any): string {
  if (!result?.content) return JSON.stringify(result);
  return result.content
    .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    .join('\n');
}
