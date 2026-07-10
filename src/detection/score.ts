import { RingEvidence } from '../model.js';

// Transparent, explainable scoring. Each signal contributes points; the agent
// later narrates *why* a ring scored the way it did.
export function scoreEvidence(e: Omit<RingEvidence, 'signals' | 'score'>): RingEvidence {
  const signals: string[] = [];
  let score = 0;

  if (e.cycle && e.cycle.length >= 3) {
    score += 35;
    signals.push(
      `Circular money flow across ${e.cycle.length - 1} accounts totaling $${Math.round(
        e.cycleAmount ?? 0
      ).toLocaleString()} — funds return to the origin (classic layering).`
    );
  }

  const bigDevice = e.sharedDevices.find((d) => d.accounts.length >= 3);
  if (bigDevice) {
    score += 25;
    signals.push(
      `${bigDevice.accounts.length} accounts share device ${bigDevice.fingerprint} — one operator, many identities.`
    );
  } else if (e.sharedDevices.length) {
    score += 10;
    signals.push(`Shared device across ${e.sharedDevices[0].accounts.length} accounts.`);
  }

  const bigIp = e.sharedIps.find((i) => i.accounts.length >= 3);
  if (bigIp) {
    score += 15;
    signals.push(`${bigIp.accounts.length} accounts share IP ${bigIp.addr}.`);
  }

  if (e.creationWindowMinutes != null && e.size >= 3 && e.creationWindowMinutes <= 60) {
    score += 15;
    signals.push(
      `All ${e.size} accounts created within ${e.creationWindowMinutes} min of each other — coordinated burst signup.`
    );
  }

  if (e.structuringCount >= 2) {
    score += 10;
    signals.push(
      `${e.structuringCount} transfers sized just under the $10k reporting threshold (structuring).`
    );
  }

  score = Math.min(100, score);
  return { ...e, signals, score };
}

export function severityFor(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}
