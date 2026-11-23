/**
 * Retrying a remote agent's failed setup script (PROTOCOL `methods/nodes.md`
 * "Retrying a remote agent's setup"): `agent.retrySetup`, gated by
 * `server.capabilities.remoteSetupRetry: 1`. The reply means the machine
 * started the script; the run then reports through `agent:updated` as the
 * first one did.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { notify } from '$lib/components/patterns/notify';
import { RemoteSetupStatusSchema, type RemoteSetupStatus } from '$shared/types/agent-node';
import { m } from '$shared/paraglide/messages.js';

/** Documented refusal codes (`error.data.code`). @internal Exported for the contract test. */
export const SETUP_RETRY_REFUSAL_CODES = [
  'setup-retry-not-remote',
  'setup-retry-not-failed',
  'setup-retry-shared-checkout',
  'setup-retry-no-script',
  'agent-busy',
  'agent-not-running',
  'machine-update-required',
  'machine-unreachable',
] as const;
type SetupRetryRefusalCode = (typeof SETUP_RETRY_REFUSAL_CODES)[number];

export type SetupRetryOutcome =
  | { ok: true; setup: RemoteSetupStatus | null }
  | {
      ok: false;
      /** A documented refusal, `unsupported` for an older daemon (`-32601`), else `unknown`. */
      code: SetupRetryRefusalCode | 'unsupported' | 'unknown';
      /** The daemon's message, when it sent one. */
      message: string;
    };

/**
 * The Retry setup action shows: the backend advertises it (exactly `1`) and
 * the agent's setup failed.
 */
export function canRetrySetup(
  supported: boolean,
  setup: Pick<RemoteSetupStatus, 'state'> | null | undefined,
): boolean {
  return supported && setup?.state === 'failed';
}

/** The request function (`backendRequest`); tests pass a stand-in. */
export type SetupRetryRequest = <T>(method: string, params: unknown) => Promise<T>;

function refusalCode(error: unknown): SetupRetryOutcome & { ok: false } {
  const e = (error ?? {}) as {
    rpcCode?: unknown;
    code?: unknown;
    data?: { code?: unknown } | null;
    message?: unknown;
  };
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.rpcCode === -32601 || e.code === 'METHOD_NOT_FOUND')
    return { ok: false, code: 'unsupported', message };
  const raw = typeof e.data?.code === 'string' ? e.data.code : e.code;
  const known = SETUP_RETRY_REFUSAL_CODES.find((code) => code === raw);
  return { ok: false, code: known ?? 'unknown', message };
}

/** Call `agent.retrySetup`; refusals and transport failures resolve as `ok: false`. */
export async function retryRemoteSetup(
  params: { workspaceId: string; agentId: string },
  request: SetupRetryRequest = backendRequest,
): Promise<SetupRetryOutcome> {
  try {
    const result = await request<{ setup?: unknown } | null>('agent.retrySetup', {
      workspaceId: params.workspaceId,
      agentId: params.agentId,
    });
    const setup = RemoteSetupStatusSchema.safeParse(result?.setup);
    return { ok: true, setup: setup.success ? setup.data : null };
  } catch (error) {
    return refusalCode(error);
  }
}

/** The toast's description for a refused retry: the daemon's words, else the app's. */
function setupRetryRefusalMessage(outcome: SetupRetryOutcome & { ok: false }): string {
  if (outcome.code === 'unsupported') return m.remoteAgent_setupRetry_unsupported_error();
  return outcome.message.trim() || m.remoteAgent_setupRetry_generic_error();
}

/** The refusal toast: which machine, and the daemon's words. */
export function notifySetupRetryRefused(
  machine: string,
  outcome: SetupRetryOutcome & { ok: false },
): void {
  notify.error(m.remoteAgent_setupRetry_failed_title({ machine }), {
    description: setupRetryRefusalMessage(outcome),
  });
}
