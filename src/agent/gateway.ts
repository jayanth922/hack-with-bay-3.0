import { config } from '../config.js';

// Butterbase exposes an OpenAI-compatible AI gateway. We call it directly with
// fetch (the openai SDK's keep-alive agent trips a "Premature close" against this
// gateway on Node 24; a plain request is both more robust and dependency-free).

export function aiConfigured(): boolean {
  return Boolean(config.ai.apiKey && config.ai.apiKey.startsWith('bb_sk_'));
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface ChatResult {
  choices: Array<{ message: { role: string; content: string | null }; finish_reason?: string }>;
}

export async function chat(
  messages: ChatMsg[],
  opts: { temperature?: number; tools?: any[] } = {}
): Promise<ChatResult> {
  const payload = JSON.stringify({
    model: config.ai.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    ...(opts.tools ? { tools: opts.tools } : {}),
  });

  let lastErr: unknown;
  // The gateway occasionally drops a keep-alive connection ("Premature close")
  // on Node's fetch — retry a couple times with a fresh connection.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 45_000);
      const res = await fetch(`${config.ai.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.ai.apiKey}`,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
        body: payload,
        signal: ac.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`AI gateway ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as ChatResult;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr;
}

/** Extract a JSON object from an LLM reply that may be fenced or wrapped in prose. */
export function extractJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in reply');
  return JSON.parse(candidate.slice(start, end + 1));
}
