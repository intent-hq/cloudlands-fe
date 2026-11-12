/**
 * Settings → Machines → Add machine → Intent on this computer (requester
 * side of local code pairing, protocol §5.58): the IPC calls to the main
 * process, which reads the discovery folder and redeems codes.
 */
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  LocalIntent,
  LocalIntentsListResult,
  LocalRedeemErrorCode,
  LocalRedeemResult,
} from '$shared/types/local-pairing';

export interface LocalIntentsApi {
  list(): Promise<LocalIntentsListResult>;
  redeem(instanceId: string, code: string): Promise<LocalRedeemResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseIntent(value: unknown): LocalIntent | null {
  if (!isRecord(value)) return null;
  const { instanceId, displayName, dataDir, accepting } = value;
  if (typeof instanceId !== 'string' || !instanceId) return null;
  if (typeof displayName !== 'string' || typeof dataDir !== 'string') return null;
  return { instanceId, displayName, dataDir, accepting: accepting === true };
}

/** @internal Exported for tests. */
export function parseListReply(reply: unknown): LocalIntentsListResult {
  if (isRecord(reply) && reply.ok === true && Array.isArray(reply.intents))
    return {
      ok: true,
      intents: reply.intents
        .map(parseIntent)
        .filter((intent): intent is LocalIntent => intent !== null),
    };
  return { ok: false, code: 'unavailable' };
}

const ERROR_CODES: ReadonlySet<LocalRedeemErrorCode> = new Set<LocalRedeemErrorCode>([
  'wrong-code',
  'locked',
  'expired',
  'code-format',
  'gone',
  'not-listening',
  'unreachable',
  'certificate',
  'refused',
  'remote-access-on',
  'unsupported',
  'busy',
  'save-failed',
  'unknown',
]);

/** @internal Exported for tests. */
export function parseRedeemReply(reply: unknown): LocalRedeemResult {
  if (!isRecord(reply)) return { ok: false, error: { code: 'unknown' } };
  if (reply.ok === true && isRecord(reply.connection) && typeof reply.connection.id === 'string')
    return reply as LocalRedeemResult;
  const error = isRecord(reply.error) ? reply.error : {};
  const code =
    typeof error.code === 'string' && ERROR_CODES.has(error.code as LocalRedeemErrorCode)
      ? (error.code as LocalRedeemErrorCode)
      : 'unknown';
  const left = error.attemptsRemaining;
  return {
    ok: false,
    error:
      code === 'wrong-code' && typeof left === 'number' && left >= 1
        ? { code, attemptsRemaining: left }
        : { code },
  };
}

function bridge() {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('local pairing bridge unavailable'); // i18n-ignore (developer diagnostic)
  return api;
}

// Each call names its channel so the IPC reachability scan can see the main handler's caller.
export const localIntentsApi: LocalIntentsApi = {
  async list() {
    try {
      return parseListReply(await bridge().invoke(IPC_CHANNELS.LOCAL_PAIRING.LIST));
    } catch {
      return { ok: false, code: 'unavailable' };
    }
  },
  async redeem(instanceId, code) {
    try {
      return parseRedeemReply(
        await bridge().invoke(IPC_CHANNELS.LOCAL_PAIRING.REDEEM, { instanceId, code }),
      );
    } catch {
      return { ok: false, error: { code: 'unknown' } };
    }
  },
};
