/**
 * Add a machine or node from an `intent://pair` link (main process).
 *
 * `inspect` parses the link, tests the owner credential, detects the daemon
 * mode and keeps the credential in a single-use pending slot that expires
 * after a few minutes. `commit` saves it, `discard` drops it. Only the pending
 * id crosses to the renderer: the token stays here and in the encrypted store.
 */

import { randomUUID } from 'crypto';
import type { DaemonMode } from '$shared/types/connections';
import type {
  PairLinkCommitResult,
  PairLinkInspected,
  PairLinkInspectResult,
  PairLinkKind,
} from '$shared/types/pair-link';
import { parsePairingUri } from '$shared/utils/pairing-uri';
import { AuthRejectedError, PinMismatchError } from './backend-connection';
import type { ConnectionRecord, NewConnection } from './connections-store';
import type { InvitedCandidate } from './invited-session-sync';
import type { PrincipalSnapshot } from '$shared/types/principal';

const PENDING_TTL_MS = 10 * 60_000;

/** Compare pins without trusting their format (a pasted link may be malformed). */
const pinKey = (value: string) => value.replaceAll(':', '').trim().toLowerCase();
const MAX_PENDING = 8;

export interface PairLinkDeps {
  inspect(candidate: InvitedCandidate): Promise<{
    snapshot: PrincipalSnapshot;
    daemonMode: DaemonMode | null;
    name: string | null;
  }>;
  findMatching(identity: {
    hosts: string[];
    port: number;
    fingerprint: string | null;
  }): Promise<ConnectionRecord | null>;
  add(conn: NewConnection): Promise<ConnectionRecord>;
  /** A member or guest credential: not an owner pairing. */
  isInvitation(snapshot: PrincipalSnapshot): boolean;
  /** Localized message when the error says the daemon is too old, else null. */
  compatibilityMessage(error: unknown): string | null;
  now?: () => number;
}

interface Pending {
  connection: NewConnection;
  expiresAt: number;
}

export interface PairLinks {
  inspect(uri: string): Promise<PairLinkInspectResult>;
  /**
   * Hold a link whose owner credential was already tested (the deep-link
   * route tests it once for every principal kind). `daemonMode` null with a
   * `mode=node` hint counts as a node.
   */
  hold(link: TestedPairLink): Promise<PairLinkInspected>;
  commit(pendingId: string): Promise<PairLinkCommitResult>;
  discard(pendingId: string): void;
}

export interface TestedPairLink {
  hosts: string[];
  port: number;
  fingerprint: string;
  token: string;
  tcAddress: string | null;
  modeHint: 'node' | null;
  daemonMode: DaemonMode | null;
  name: string | null;
}

export function createPairLinks(deps: PairLinkDeps): PairLinks {
  const now = deps.now ?? Date.now;
  const pending = new Map<string, Pending>();

  function prune() {
    const time = now();
    for (const [id, entry] of pending) if (entry.expiresAt <= time) pending.delete(id);
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
  }

  async function inspect(uri: string): Promise<PairLinkInspectResult> {
    const parsed = typeof uri === 'string' ? parsePairingUri(uri) : null;
    if (!parsed) return { ok: false, code: 'not-a-link' };
    const { hosts, port, fingerprint, token, tcAddress, modeHint } = parsed;
    if ((hosts.length === 0 && !tcAddress) || port === null || !fingerprint || !token)
      return { ok: false, code: 'incomplete' };
    const host = hosts[0] ?? tcAddress!;
    let inspected: Awaited<ReturnType<PairLinkDeps['inspect']>>;
    try {
      inspected = await deps.inspect({ host, hosts, port, fingerprint, token, tcAddress });
    } catch (error) {
      if (error instanceof AuthRejectedError) return { ok: false, code: 'rejected' };
      if (error instanceof PinMismatchError) return { ok: false, code: 'certificate' };
      const message = deps.compatibilityMessage(error);
      if (message) return { ok: false, code: 'incompatible', message };
      return {
        ok: false,
        code: 'unreachable',
        routes: [...hosts.map((h) => `${h}:${port}`), ...(tcAddress ? [tcAddress] : [])],
      };
    }
    if (deps.isInvitation(inspected.snapshot) || !inspected.snapshot.principal.isAdministrator)
      return { ok: false, code: 'not-owner' };

    return hold({
      hosts,
      port,
      fingerprint,
      token,
      tcAddress,
      modeHint,
      daemonMode: inspected.daemonMode,
      name: inspected.name,
    });
  }

  async function hold(link: TestedPairLink): Promise<PairLinkInspected> {
    const { hosts, port, fingerprint, token, tcAddress } = link;
    const host = hosts[0] ?? tcAddress ?? '';
    const daemonMode = link.daemonMode ?? (link.modeHint === 'node' ? 'node' : null);
    const kind: PairLinkKind = daemonMode === 'node' ? 'node' : 'machine';
    const match = await deps.findMatching({
      hosts: hosts.length ? hosts : [host],
      port,
      fingerprint,
    });
    const existing =
      match?.fingerprint && pinKey(match.fingerprint) === pinKey(fingerprint) ? match : null;
    const label = existing?.label ?? link.name ?? host;

    prune();
    const pendingId = randomUUID();
    pending.set(pendingId, {
      connection: {
        label,
        host,
        port,
        fingerprint,
        token,
        ...(tcAddress ? { tcAddress } : {}),
        ...(daemonMode ? { daemonMode } : {}),
      },
      expiresAt: now() + PENDING_TTL_MS,
    });
    return { ok: true, pendingId, kind, label, existingId: existing?.id ?? null };
  }

  async function commit(pendingId: string): Promise<PairLinkCommitResult> {
    const entry = pending.get(pendingId);
    pending.delete(pendingId);
    if (!entry || entry.expiresAt <= now()) return { ok: false, code: 'expired' };
    try {
      return { ok: true, connection: await deps.add(entry.connection) };
    } catch {
      return { ok: false, code: 'failed' };
    }
  }

  function discard(pendingId: string) {
    pending.delete(pendingId);
  }

  return { inspect, hold, commit, discard };
}
