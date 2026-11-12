/**
 * Pure rules of B's code panel: how daemon updates merge into the shown code
 * and which view the panel renders at a given moment.
 */
import type {
  LocalPairingCode,
  LocalPairingPanelFailure,
  LocalPairingPanelStep,
} from './local-pairing-types';

/** Wrong tries a fresh code allows (§5.58 Limits). */
export const LOCAL_PAIRING_MAX_ATTEMPTS = 5;

const TERMINAL_CODE_STATES: ReadonlySet<LocalPairingCode['state']> = new Set([
  'redeemed',
  'expired',
  'cancelled',
  'locked',
]);

export const isTerminalCode = (code: LocalPairingCode): boolean =>
  TERMINAL_CODE_STATES.has(code.state);

/**
 * Merge a daemon update into the shown code. Updates for another code are
 * ignored. The first terminal state sticks: the daemon later reports a locked
 * code as expired once its original expiry passes, but the user should keep
 * seeing why the code stopped working. While active, tries only go down.
 */
export function mergeCodeUpdate(
  current: LocalPairingCode | null,
  update: LocalPairingCode,
): LocalPairingCode | null {
  if (!current || current.codeId !== update.codeId) return current;
  if (isTerminalCode(current)) return current;
  if (update.state === 'active')
    return {
      ...update,
      attemptsRemaining: Math.min(current.attemptsRemaining, update.attemptsRemaining),
    };
  return update;
}

export type CodePanelView =
  | { kind: 'closed' }
  | { kind: 'creating' }
  | { kind: 'confirm-listener' }
  | { kind: 'enabling-listener' }
  | { kind: 'failed'; failure: LocalPairingPanelFailure }
  | {
      kind: 'active';
      codeId: string;
      remainingMs: number;
      attemptsRemaining: number;
      /** Cancelling the code failed; the code itself is still active. */
      cancelFailed: boolean;
    }
  | { kind: 'connected'; appName: string | null }
  | { kind: 'expired' }
  | { kind: 'locked' }
  | { kind: 'cancelled'; reason: NonNullable<LocalPairingCode['cancelReason']> };

/** Milliseconds until `expiresAt`, never negative. */
function remainingMs(expiresAt: string, nowMs: number): number {
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) ? 0 : Math.max(0, at - nowMs);
}

/**
 * The panel view at `nowMs`. An active code past its expiry already reads as
 * expired, before the daemon's `expired` update arrives (it may lag by up to
 * a second).
 */
export function codePanelView(
  step: LocalPairingPanelStep,
  code: LocalPairingCode | null,
  failure: LocalPairingPanelFailure | null,
  nowMs: number,
): CodePanelView {
  if (step === 'closed') return { kind: 'closed' };
  if (step === 'creating') return { kind: 'creating' };
  if (step === 'confirm-listener') return { kind: 'confirm-listener' };
  if (step === 'enabling-listener') return { kind: 'enabling-listener' };
  if (!code) return { kind: 'failed', failure: failure ?? 'create-failed' };
  switch (code.state) {
    case 'redeemed':
      return { kind: 'connected', appName: code.appName ?? null };
    case 'expired':
      return { kind: 'expired' };
    case 'locked':
      return { kind: 'locked' };
    case 'cancelled':
      return { kind: 'cancelled', reason: code.cancelReason ?? 'user' };
    case 'active': {
      const left = remainingMs(code.expiresAt, nowMs);
      if (left === 0) return { kind: 'expired' };
      return {
        kind: 'active',
        codeId: code.codeId,
        remainingMs: left,
        attemptsRemaining: code.attemptsRemaining,
        cancelFailed: failure === 'cancel-failed',
      };
    }
  }
}

/** Error data `code` of a daemon rejection, when present. */
function errorDataCode(error: unknown): string | null {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data !== 'object' || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function rpcCode(error: unknown): number | null {
  const code = (error as { rpcCode?: unknown } | null)?.rpcCode;
  return typeof code === 'number' ? code : null;
}

/** `-32603 { code: "listener-down" }` from `pairing.createLocalCode`. */
export const isListenerDown = (error: unknown): boolean =>
  rpcCode(error) === -32603 && errorDataCode(error) === 'listener-down';

/**
 * The daemon refuses local pairing while its remote access (Tailcat) tunnel
 * is on, because tunnel traffic reaches the listener from loopback:
 * `-32603 { code: "tunnel-active" }`. Any other data code naming the tunnel
 * counts too.
 */
export const isRemoteAccessRefusal = (error: unknown): boolean =>
  /tunnel|remote-access/i.test(errorDataCode(error) ?? '');

/**
 * The local link cannot serve the administration methods: `-32001` means the
 * desktop app reaches its daemon over TCP/WSS (for example an `INTENTD_WS_URL`
 * or `INTENTD_TCP` override) instead of the UDS / named-pipe bridge, and
 * `-32601` means the daemon predates the methods.
 */
export const isLocalLinkUnsupported = (error: unknown): boolean => {
  const code = rpcCode(error);
  return code === -32001 || code === -32601;
};
