import { chat, aiConfigured, extractJson, ChatMsg } from './gateway.js';
import { DetectedRing } from '../detection/detect.js';
import { Verdict } from '../model.js';
import { severityFor } from '../detection/score.js';

const SYSTEM = `You are RingLeader, an expert financial-crime investigator AI.
You are given structured graph evidence about a suspected fraud ring detected in a
transaction network (Neo4j). Your job: explain, in clear plain English a compliance
analyst can act on, WHY these accounts form a fraud ring and what to do next.

Rules:
- Be specific and cite the evidence (accounts, amounts, shared devices, timing).
- Do not invent evidence beyond what is provided.
- Tone: crisp, confident, professional. No hedging filler.
Return STRICT JSON with keys: headline (<=90 chars), explanation (2-4 sentences),
recommendedAction (1-2 sentences), keyEvidence (array of 3-5 short bullet strings).`;

function evidenceToPrompt(ring: DetectedRing): string {
  return JSON.stringify(
    {
      accounts: ring.ringAccounts,
      size: ring.size,
      riskScore: ring.score,
      moneyCycle: ring.cycle,
      moneyCycleTotalUSD: ring.cycleAmount,
      totalFlowUSD: ring.totalFlow,
      sharedDevices: ring.sharedDevices,
      sharedIps: ring.sharedIps,
      accountCreationWindowMinutes: ring.creationWindowMinutes,
      transfersJustUnder10kThreshold: ring.structuringCount,
      detectedSignals: ring.signals,
    },
    null,
    2
  );
}

/** Deterministic fallback so the product is fully demoable before the AI gateway is wired. */
function templateVerdict(ring: DetectedRing): Verdict {
  const cycleTxt =
    ring.cycle && ring.cycleAmount
      ? `funds cycle ${ring.cycle.slice(0, ring.cycle.length - 1).join(' → ')} → back to origin, moving ~$${Math.round(
          ring.cycleAmount
        ).toLocaleString()}`
      : 'accounts move funds among themselves';
  return {
    ringAccounts: ring.ringAccounts,
    score: ring.score,
    severity: ring.severity,
    headline: `${ring.severity.toUpperCase()} risk fraud ring: ${ring.size} accounts, ${cycleTxt}`,
    explanation:
      `These ${ring.size} accounts behave as a single coordinated operation. ` +
      ring.signals.join(' ') +
      ` In isolation each transaction looks ordinary; only the graph reveals the ring.`,
    recommendedAction:
      ring.score >= 60
        ? 'Freeze all accounts in the ring, file a SAR, and escalate to the fraud investigations team.'
        : 'Flag for manual review and monitor for further coordinated activity.',
    keyEvidence: ring.signals.slice(0, 5),
  };
}

export async function investigate(ring: DetectedRing): Promise<Verdict & { source: 'ai' | 'template' }> {
  if (!aiConfigured()) {
    return { ...templateVerdict(ring), source: 'template' };
  }
  try {
    const messages: ChatMsg[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Suspected fraud ring evidence:\n${evidenceToPrompt(ring)}` },
    ];
    const res = await chat(messages, { temperature: 0.2 });
    const raw = res.choices[0]?.message?.content ?? '{}';
    const json = extractJson(raw);
    return {
      ringAccounts: ring.ringAccounts,
      score: ring.score,
      severity: severityFor(ring.score),
      headline: json.headline ?? templateVerdict(ring).headline,
      explanation: json.explanation ?? '',
      recommendedAction: json.recommendedAction ?? '',
      keyEvidence: Array.isArray(json.keyEvidence) ? json.keyEvidence : ring.signals,
      source: 'ai',
    };
  } catch (err) {
    // Never let the demo die on a gateway hiccup.
    if (process.env.DEBUG_AI) console.error('[investigator] fell back to template:', (err as Error).message);
    return { ...templateVerdict(ring), source: 'template' };
  }
}
