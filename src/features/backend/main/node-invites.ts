/**
 * Add a machine from an `intent://node` link (main process).
 *
 * `inspect` checks the link (v1, every field present) and holds it in a
 * single-use pending slot that expires after a few minutes; only the pending
 * id and the first host cross to the renderer. `claim` hands the link to the
 * current backend, which dials the machine, trades the invite for an executor
 * credential and saves the machine. The app never connects to the machine.
 */

import { randomUUID } from 'crypto';
import {
  NODE_INVITE_CLAIM_METHOD,
  NODE_INVITE_DAEMON_CODES,
  NODE_INVITE_LINK_VERSION,
  type NodeInviteClaimErrorCode,
  type NodeInviteClaimParams,
  type NodeInviteClaimResult,
  type NodeInviteInspectResult,
} from '$shared/types/node-invite';
import { parseRemoteMachine } from '$shared/types/remote-machines';
import { parseNodeInviteUri } from '$shared/utils/node-invite-uri';

const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING = 8;
/** The backend probes the machine (route race, pin, invite) before saving. */
const CLAIM_TIMEOUT_MS = 45_000;

interface NodeInviteBackend {
  request(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
}

export interface NodeInvites {
  inspect(uri: unknown): NodeInviteInspectResult;
  claim(pendingId: string, backend: NodeInviteBackend): Promise<NodeInviteClaimResult>;
  discard(pendingId: string): void;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const DAEMON_CODES: ReadonlySet<string> = new Set(NODE_INVITE_DAEMON_CODES);

const CERTIFICATE_MISMATCH = 'node-link-certificate-mismatch';

function claimFailure(error: unknown): NodeInviteClaimResult {
  const rpcCode =
    record(error) || error instanceof Error ? (error as { rpcCode?: unknown }).rpcCode : undefined;
  if (rpcCode === -32601) return { ok: false, code: 'backend-unsupported' };
  if (rpcCode === -32003) return { ok: false, code: 'not-owner' };
  const data = (error as { data?: unknown } | null)?.data;
  if (!record(data) || !text(data.code) || !DAEMON_CODES.has(data.code))
    return { ok: false, code: 'failed' };
  const code = data.code as NodeInviteClaimErrorCode;
  if (code !== 'machine-unreachable' && code !== 'machine-update-required')
    return { ok: false, code };
  const inviteSpent = data.inviteSpent === true;
  if (code === 'machine-update-required') return { ok: false, code, inviteSpent };
  const attempts = Array.isArray(data.attempts) ? data.attempts.filter(record) : [];
  if (attempts.length > 0 && attempts.every((attempt) => attempt.error === CERTIFICATE_MISMATCH))
    return { ok: false, code: 'certificate-mismatch', inviteSpent };
  const routes = attempts.flatMap((attempt) => (text(attempt.route) ? [attempt.route] : []));
  return { ok: false, code, inviteSpent, ...(routes.length ? { routes } : {}) };
}

export function createNodeInvites(deps: { now?: () => number } = {}): NodeInvites {
  const now = deps.now ?? Date.now;
  const pending = new Map<string, { params: NodeInviteClaimParams; expiresAt: number }>();

  function prune() {
    const time = now();
    for (const [id, entry] of pending) if (entry.expiresAt <= time) pending.delete(id);
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
  }

  function inspect(uri: unknown): NodeInviteInspectResult {
    const parsed = typeof uri === 'string' ? parseNodeInviteUri(uri) : null;
    if (!parsed) return { ok: false, code: 'not-a-link' };
    const { version, hosts, port, fingerprint, tcAddress, inviteId, secret } = parsed;
    if (version === null) return { ok: false, code: 'incomplete' };
    if (version !== NODE_INVITE_LINK_VERSION) return { ok: false, code: 'link-version' };
    if ((hosts.length === 0 && !tcAddress) || port === null || !fingerprint || !inviteId || !secret)
      return { ok: false, code: 'incomplete' };
    prune();
    const pendingId = randomUUID();
    pending.set(pendingId, {
      params: { uri: (uri as string).trim() },
      expiresAt: now() + PENDING_TTL_MS,
    });
    return { ok: true, pendingId, label: hosts[0] ?? null };
  }

  async function claim(
    pendingId: string,
    backend: NodeInviteBackend,
  ): Promise<NodeInviteClaimResult> {
    const entry = pending.get(pendingId);
    pending.delete(pendingId);
    if (!entry || entry.expiresAt <= now()) return { ok: false, code: 'expired' };
    let reply: unknown;
    try {
      reply = await backend.request(NODE_INVITE_CLAIM_METHOD, entry.params, {
        timeoutMs: CLAIM_TIMEOUT_MS,
      });
    } catch (error) {
      return claimFailure(error);
    }
    const machine = record(reply) ? parseRemoteMachine(reply.machine) : null;
    return machine ? { ok: true, machine } : { ok: false, code: 'failed' };
  }

  return { inspect, claim, discard: (pendingId) => void pending.delete(pendingId) };
}
