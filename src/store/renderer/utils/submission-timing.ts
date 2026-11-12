import { createLogger } from '$lib/utils/client-logger';
import { sameSubmissionScope } from '$store/renderer/slices/pending-submissions/pending-submissions-model';
import type { SubmissionScope } from '$store/renderer/slices/pending-submissions/pending-submissions-types';
export type DockSendStage =
  | 'validate'
  | 'transcribe'
  | 'plan'
  | 'screenshot-source'
  | 'screenshot-render'
  | 'overlay-render'
  | 'export'
  | 'placement'
  | 'burn'
  | 'admission'
  | 'barrier';

const logger = createLogger('DockSendTiming');
type Stage = DockSendStage | 'barrier' | 'target' | 'preparation' | 'release' | 'admission';
type Outcome = 'accepted' | 'rejected' | 'uncertain' | 'cancelled' | 'failed';
const attempts = new Map<string, DockSendTiming>();
const LIMIT = 32;
const MAX_AGE_MS = 10 * 60_000;

/** Only fixed labels, elapsed times and fresh random correlation tokens leave this module. */
function report(data: Record<string, unknown>): void {
  try {
    logger.info('Dock send timing', data);
  } catch {
    // Diagnostics must never change delivery or draft ownership.
  }
}

export class DockSendTiming {
  readonly started = performance.now();
  readonly token = crypto.randomUUID();
  private at = this.started;
  private currentStage: Stage = 'barrier';
  private durations: Partial<Record<Stage, number>> = {};
  private admittedAt: number | null = null;
  private pending: { scope: Readonly<SubmissionScope>; id: string } | null = null;
  private done = false;

  constructor(readonly composerId: string) {}

  stage(next: Stage): void {
    if (this.done || this.admittedAt !== null) return;
    const now = performance.now();
    this.durations[this.currentStage] =
      (this.durations[this.currentStage] ?? 0) + Math.max(0, now - this.at);
    this.at = now;
    this.currentStage = next;
  }

  exportAttempt(exportToken: string): void {
    if (this.done) return;
    report({ attemptToken: this.token, exportToken, stage: 'export-start' });
  }

  admit(scope: SubmissionScope, id: string): void {
    if (this.done) return;
    this.stage('admission');
    this.admittedAt = performance.now();
    this.pending = { scope: Object.freeze({ ...scope }), id };
    report({
      attemptToken: this.token,
      stage: 'local-admission',
      clickToAdmissionMs: Math.round(this.admittedAt - this.started),
      durationsMs: Object.fromEntries(
        Object.entries(this.durations).map(([key, value]) => [key, Math.round(value)]),
      ),
    });
  }

  matches(scope: SubmissionScope, id: string): boolean {
    return this.pending?.id === id && sameSubmissionScope(this.pending.scope, scope);
  }

  finish(outcome: Outcome): void {
    if (this.done) return;
    this.stage(this.currentStage);
    const now = performance.now();
    this.done = true;
    attempts.delete(this.composerId);
    report({
      attemptToken: this.token,
      stage: this.admittedAt === null ? 'pre-admission-end' : 'daemon-result',
      outcome,
      clickToResultMs: Math.round(now - this.started),
      ...(this.admittedAt === null
        ? {
            durationsMs: Object.fromEntries(
              Object.entries(this.durations).map(([key, value]) => [key, Math.round(value)]),
            ),
          }
        : { admissionToResultMs: Math.round(now - this.admittedAt) }),
    });
  }

  cancelBeforeAdmission(): void {
    if (this.admittedAt === null) this.finish('cancelled');
  }
}

function prune(): void {
  const now = performance.now();
  for (const [key, value] of attempts) if (now - value.started > MAX_AGE_MS) attempts.delete(key);
  while (attempts.size > LIMIT) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

export function beginDockSendTiming(composerId: string): DockSendTiming {
  prune();
  const timing = new DockSendTiming(composerId);
  attempts.set(composerId, timing);
  prune();
  return timing;
}

export function dockSendTimingFor(composerId?: string): DockSendTiming | undefined {
  prune();
  return composerId ? attempts.get(composerId) : undefined;
}

export function settleDockSendTiming(
  scope: SubmissionScope,
  id: string,
  outcome: 'accepted' | 'rejected' | 'uncertain',
): void {
  prune();
  for (const timing of attempts.values()) if (timing.matches(scope, id)) timing.finish(outcome);
}
