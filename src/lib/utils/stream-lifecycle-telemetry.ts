import { LogCategory, logger } from '$lib/logging/logger.svelte';

export interface StreamLifecycleDiagnostic {
  stage: 'subscription' | 'bridge' | 'store' | 'render';
  event: string;
  turnCorrelation?: string;
  subscriptionGeneration?: number;
  transportGeneration?: number;
  pushKind?: 'snapshot' | 'delta';
  pushSeq?: number;
  reconcilerResult?: 'applied' | 'duplicate' | 'stale' | 'gap' | 'reset';
  callbackResult?: 'delivered' | 'not-invoked' | 'buffered' | 'ignored' | 'threw';
  storeStreamState?: 'streaming' | 'idle' | 'error' | 'missing';
  blockCount?: number;
  terminalErrorVisible?: boolean;
}

/** Hard cap keeps this diagnostic family bounded for one renderer session. */
export const MAX_STREAM_LIFECYCLE_DIAGNOSTICS = 2_048;

let emittedCount = 0;

/**
 * Content-free correlation derived from a high-entropy wire id. The source id
 * is never retained or logged. FNV-1a matches the daemon telemetry helper.
 */
export function streamTurnCorrelation(wireId: string | undefined): string | undefined {
  if (!wireId) return undefined;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(wireId)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function reportStreamLifecycle(diagnostic: StreamLifecycleDiagnostic): void {
  if (emittedCount >= MAX_STREAM_LIFECYCLE_DIAGNOSTICS) return;
  emittedCount += 1;
  // i18n-ignore (internal diagnostic event name)
  logger.info(LogCategory.AGENT, 'stream-lifecycle', diagnostic);
}

export function __resetStreamLifecycleTelemetryForTests(): void {
  emittedCount = 0;
}
