import { z } from 'zod';

const duration = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const progress = z
  .object({
    completedNotes: duration,
    totalNotes: duration,
    processedSourceBytes: duration,
    totalSourceBytes: duration,
  })
  .refine((p) => p.completedNotes <= p.totalNotes && p.processedSourceBytes <= p.totalSourceBytes);
const schema = z
  .object({
    startupStatus: z.literal(1),
    attemptId: z.string().min(1),
    phase: z.enum(['preparing', 'indexing', 'finalizing', 'ready', 'failed']),
    elapsedMs: duration,
    phaseElapsedMs: duration,
    progressAgeMs: duration,
    retryAfterMs: z.number().int().min(1000).max(30000).optional(),
    progress: progress.optional(),
    estimatedRemainingMs: duration.optional(),
    finalizingStep: z.enum(['anchors', 'committing', 'services']).optional(),
    failure: z
      .object({
        code: z.literal('startup-failed'),
        message: z.literal('Daemon startup failed. Check daemon logs.'),
      })
      .optional(),
  })
  .refine((s) => {
    const terminal = s.phase === 'ready' || s.phase === 'failed';
    return (
      (terminal ? s.retryAfterMs === undefined : s.retryAfterMs !== undefined) &&
      (s.phase === 'finalizing'
        ? s.finalizingStep !== undefined
        : s.finalizingStep === undefined) &&
      (s.phase === 'failed' ? s.failure !== undefined : s.failure === undefined) &&
      (s.estimatedRemainingMs === undefined || s.phase === 'indexing')
    );
  });

export type StartupSnapshot = z.infer<typeof schema>;
/** A failed poll never presents its cached snapshot as current. */
export interface StartupState {
  snapshot: StartupSnapshot | null;
  available: boolean;
}
export function parseStartupSnapshot(value: unknown): StartupSnapshot | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
export function isStartupError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { rpcCode?: unknown; code?: unknown; data?: { code?: unknown } };
  return (e.rpcCode ?? e.code) === -32012;
}
export function startupFromError(error: unknown): StartupSnapshot | null {
  if (!isStartupError(error)) return null;
  return parseStartupSnapshot((error as { data?: { startup?: unknown } }).data?.startup);
}
