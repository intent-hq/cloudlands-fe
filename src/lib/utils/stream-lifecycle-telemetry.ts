import { LogCategory, logger } from '$lib/logging/logger.svelte';

export interface StreamLifecycleDiagnostic {
  stage: 'subscription' | 'bridge' | 'store' | 'render';
  event: string;
  turnCorrelation?: string;
  turnIdCorrelation?: string;
  correlationBasis?: 'assistant-message' | 'turn' | 'unjoinable';
  subscriptionGeneration?: number;
  transportGeneration?: number;
  pushKind?: 'snapshot' | 'delta';
  pushSeq?: number;
  reconcilerResult?: 'applied' | 'duplicate' | 'stale' | 'gap' | 'reset';
  callbackResult?:
    | 'received'
    | 'dispatched'
    | 'observed'
    | 'delivered'
    | 'not-invoked'
    | 'buffered'
    | 'ignored'
    | 'threw';
  storeStreamState?: 'streaming' | 'idle' | 'error' | 'missing';
  blockCount?: number;
  terminalErrorVisible?: boolean;
}

/** Hard cap keeps this diagnostic family bounded for one renderer session. */
export const MAX_STREAM_LIFECYCLE_DIAGNOSTICS = 2_048;
export const RESERVED_TERMINAL_STREAM_LIFECYCLE_DIAGNOSTICS = 256;

let ordinaryEmittedCount = 0;
let lateFailureEmittedCount = 0;
let lateRenderEmittedCount = 0;

const LATE_FAILURE_RESERVE = 192;
const LATE_RENDER_RESERVE = 64;

function lateReserveKind(diagnostic: StreamLifecycleDiagnostic): 'failure' | 'render' | undefined {
  if (
    diagnostic.stage === 'render' &&
    (diagnostic.event.includes('not-committed') ||
      diagnostic.terminalErrorVisible === true ||
      diagnostic.callbackResult === 'ignored' ||
      diagnostic.callbackResult === 'threw')
  ) {
    return 'render';
  }
  if (
    diagnostic.callbackResult === 'threw' ||
    diagnostic.storeStreamState === 'error' ||
    diagnostic.event.includes('failed') ||
    diagnostic.event.includes('error')
  ) {
    return 'failure';
  }
  return undefined;
}

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
  const ordinaryLimit =
    MAX_STREAM_LIFECYCLE_DIAGNOSTICS - RESERVED_TERMINAL_STREAM_LIFECYCLE_DIAGNOSTICS;
  if (ordinaryEmittedCount < ordinaryLimit) {
    ordinaryEmittedCount += 1;
  } else {
    const kind = lateReserveKind(diagnostic);
    if (kind === 'failure' && lateFailureEmittedCount < LATE_FAILURE_RESERVE) {
      lateFailureEmittedCount += 1;
    } else if (kind === 'render' && lateRenderEmittedCount < LATE_RENDER_RESERVE) {
      lateRenderEmittedCount += 1;
    } else {
      return;
    }
  }
  // i18n-ignore (internal diagnostic event name)
  logger.info(LogCategory.AGENT, 'stream-lifecycle', diagnostic);
}

export function __resetStreamLifecycleTelemetryForTests(): void {
  ordinaryEmittedCount = 0;
  lateFailureEmittedCount = 0;
  lateRenderEmittedCount = 0;
}
