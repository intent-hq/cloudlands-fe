/**
 * Remote-machine relay (main process) — "Make available to <current backend>".
 *
 * The frontend main process is the only party connected to both daemons, so it
 * relays the expose flow (PROTOCOL `methods/nodes.md` → "Expose flow"):
 *   1. `remoteMachines.backendInfo` on the current backend,
 *   2. `executor.mint` on the machine over its owner connection,
 *   3. `remoteMachines.add` on the backend, which probes before saving;
 *      when it fails, `executor.revoke` on the machine so no orphaned
 *      credential remains.
 * The executor token exists only in local variables of {@link expose}: it is
 * never logged, persisted, returned, or sent to the renderer.
 *
 * Exposing the local machine needs its WSS listener or tailcat to be on; the
 * relay reports `listener-off` and, once the user picked one, turns it on and
 * re-reads the routes from `server.pairingInfo`.
 */

import { isLoopbackHost } from '$shared/loopback-host';
import {
  fingerprintKey,
  parseRemoteMachine,
  type RemoteMachineExposeParams,
  type RemoteMachineExposeResult,
  type RemoteMachineFailure,
  type RemoteMachineFailureCode,
  type RemoteMachineListener,
  type RemoteMachineRouteAttempt,
  type RemoteMachineUnexposeParams,
  type RemoteMachineUnexposeResult,
} from '$shared/types/remote-machines';
import { setConnectionTunnel } from './connection-tunnel';
import { relayErrorMessage } from './json-rpc-errors';

/** The subset of JsonRpcClient the relay needs (injectable for tests). */
export interface RemoteMachineRpcClient {
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T>;
}

/** The current backend: the invoking window's daemon. */
export interface RemoteMachineBackend {
  connectionId: string;
  client: RemoteMachineRpcClient;
  /** `client.hello.server.capabilities.remoteMachines === 1`. */
  supportsRemoteMachines: boolean;
}

export interface RemoteMachineRelayDeps {
  localConnectionId: string;
  /** Live pooled client for a saved connection, without creating one. */
  getMachineClient(connectionId: string): RemoteMachineRpcClient | undefined;
  /** True only for owner-registry machines, never guest sessions. */
  isOwnerConnection(connectionId: string): Promise<boolean>;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface RemoteMachineRelay {
  expose(
    params: RemoteMachineExposeParams,
    backend: RemoteMachineBackend,
  ): Promise<RemoteMachineExposeResult>;
  unexpose(
    params: RemoteMachineUnexposeParams,
    backend: RemoteMachineBackend,
  ): Promise<RemoteMachineUnexposeResult>;
  /** Normalized WSS certificate fingerprint of a connected machine, or null. */
  machineFingerprint(connectionId: string): Promise<string | null>;
}

/** The backend probes (route race, pin, token, bind, capabilities) before saving. */
const ADD_TIMEOUT_MS = 45_000;
/** `remove` with `stopAgents` waits up to 30 s for the machine to acknowledge every stop. */
const REMOVE_STOP_AGENTS_TIMEOUT_MS = 45_000;

const DAEMON_CODES: ReadonlySet<RemoteMachineFailureCode> = new Set([
  'machine-update-required',
  'machine-unreachable',
  'machine-in-use',
]);

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function fail(
  code: RemoteMachineFailureCode,
  extra: Partial<RemoteMachineFailure> = {},
): RemoteMachineFailure {
  return { success: false, code, ...extra };
}

class RelayRefusal extends Error {
  constructor(readonly failure: RemoteMachineFailure) {
    super(failure.code);
  }
}

function rpcCodeOf(error: unknown): number | undefined {
  return record(error) || error instanceof Error
    ? typeof (error as { rpcCode?: unknown }).rpcCode === 'number'
      ? ((error as { rpcCode: number }).rpcCode as number)
      : undefined
    : undefined;
}

function dataOf(error: unknown): Record<string, unknown> {
  const data = (error as { data?: unknown } | null)?.data;
  return record(data) ? data : {};
}

/** Map a daemon error to a relay failure; `side` names who answered `-32601`. */
function mapError(error: unknown, side: 'machine' | 'backend'): RemoteMachineFailure {
  const rpcCode = rpcCodeOf(error);
  if (rpcCode === -32601) return fail('machine-update-required', { update: side });
  if (rpcCode === -32003) return fail('not-owner');
  const data = dataOf(error);
  const message = relayErrorMessage(error);
  const code = data.code as RemoteMachineFailureCode;
  if (!DAEMON_CODES.has(code)) return fail('failed', { message });
  const extra: Partial<RemoteMachineFailure> = { message };
  if (code === 'machine-unreachable' && Array.isArray(data.attempts)) {
    extra.attempts = data.attempts.flatMap((attempt): RemoteMachineRouteAttempt[] =>
      record(attempt) && text(attempt.route) && text(attempt.error)
        ? [{ route: attempt.route, error: attempt.error }]
        : [],
    );
  }
  if (code === 'machine-unreachable' && Array.isArray(data.unconfirmedStops))
    extra.unconfirmedStops = data.unconfirmedStops.filter(text);
  if (code === 'machine-update-required') {
    extra.update = data.update === 'backend' ? 'backend' : 'machine';
    if (text(data.machineVersion)) extra.machineVersion = data.machineVersion;
    if (text(data.backendVersion)) extra.backendVersion = data.backendVersion;
  }
  if (code === 'machine-in-use' && Number.isSafeInteger(data.runningAgents))
    extra.runningAgents = data.runningAgents as number;
  return fail(code, extra);
}

interface PairingRoutes {
  fingerprint: string | null;
  routable: boolean;
}

function parsePairingRoutes(value: unknown): PairingRoutes {
  if (!record(value)) return { fingerprint: null, routable: false };
  const port = Number.isInteger(value.port) && (value.port as number) > 0;
  const hosts = Array.isArray(value.localIps)
    ? value.localIps.filter((ip): ip is string => text(ip) && !isLoopbackHost(ip.trim()))
    : [];
  return {
    fingerprint: fingerprintKey(text(value.certFingerprint) ? value.certFingerprint : null),
    routable: (port && hosts.length > 0) || text(value.tcAddress),
  };
}

interface MintedCredential {
  credentialId: string;
  token: string;
  machine: {
    daemonId: string;
    name: string;
    port: number;
    hosts: string[];
    tcAddress?: string;
    fingerprint: string;
  };
}

function parseMint(value: unknown): MintedCredential | null {
  if (!record(value) || !text(value.credentialId) || !text(value.token)) return null;
  const machine = value.machine;
  if (
    !record(machine) ||
    !text(machine.daemonId) ||
    !text(machine.name) ||
    !Number.isInteger(machine.port) ||
    !text(machine.fingerprint)
  )
    return null;
  return {
    credentialId: value.credentialId,
    token: value.token,
    machine: {
      daemonId: machine.daemonId,
      name: machine.name,
      port: machine.port as number,
      hosts: Array.isArray(machine.hosts) ? machine.hosts.filter(text) : [],
      ...(text(machine.tcAddress) && machine.tcAddress.trim()
        ? { tcAddress: machine.tcAddress.trim() }
        : {}),
      fingerprint: machine.fingerprint,
    },
  };
}

export function createRemoteMachineRelay(deps: RemoteMachineRelayDeps): RemoteMachineRelay {
  /** Best-effort revoke on the machine; true when the credential is gone. */
  async function revoke(machine: RemoteMachineRpcClient, credentialId: string): Promise<boolean> {
    try {
      await machine.request('executor.revoke', { credentialId });
      return true;
    } catch (error) {
      if (dataOf(error).code === 'not-found') return true;
      deps.logger.warn('executor.revoke failed (best-effort)', {
        credentialId,
        error: relayErrorMessage(error),
      });
      return false;
    }
  }

  async function ownerMachine(connectionId: string): Promise<RemoteMachineRpcClient> {
    if (!(await deps.isOwnerConnection(connectionId))) throw new RelayRefusal(fail('not-owner'));
    const machine = deps.getMachineClient(connectionId);
    if (!machine) throw new RelayRefusal(fail('machine-not-connected'));
    let principal: unknown;
    try {
      principal = await machine.request('principal.me');
    } catch (error) {
      throw new RelayRefusal(mapError(error, 'machine'));
    }
    if (!record(principal) || principal.isAdministrator !== true)
      throw new RelayRefusal(fail('not-owner'));
    return machine;
  }

  async function enableListener(
    machine: RemoteMachineRpcClient,
    listener: RemoteMachineListener,
  ): Promise<void> {
    await machine.request('settings.update', {
      changes: [{ path: 'server.wsApi.enabled', value: true }],
    });
    if (listener === 'tailcat')
      await setConnectionTunnel((method, params) => machine.request(method, params), true);
  }

  /** Local machine only: make sure another daemon can reach it at all. */
  async function ensureListener(
    machine: RemoteMachineRpcClient,
    listener: RemoteMachineListener | undefined,
  ): Promise<void> {
    if (parsePairingRoutes(await machine.request('server.pairingInfo')).routable) return;
    if (!listener) throw new RelayRefusal(fail('listener-off'));
    await enableListener(machine, listener);
    if (!parsePairingRoutes(await machine.request('server.pairingInfo')).routable)
      throw new RelayRefusal(fail('listener-off'));
  }

  async function expose(
    params: RemoteMachineExposeParams,
    backend: RemoteMachineBackend,
  ): Promise<RemoteMachineExposeResult> {
    const connectionId = params.machineConnectionId;
    if (!backend.supportsRemoteMachines) return fail('unsupported-backend');
    if (connectionId === backend.connectionId) return fail('same-machine');
    try {
      const machine = await ownerMachine(connectionId);
      if (connectionId === deps.localConnectionId)
        await ensureListener(machine, params.enableListener);

      let info: unknown;
      try {
        info = await backend.client.request('remoteMachines.backendInfo');
      } catch (error) {
        return mapError(error, 'backend');
      }
      if (!record(info) || !text(info.backendId) || !text(info.backendName)) return fail('failed');

      let minted: MintedCredential | null;
      try {
        minted = parseMint(
          await machine.request('executor.mint', {
            backendId: info.backendId,
            backendName: info.backendName,
            ...(text(info.fingerprint) ? { backendFingerprint: info.fingerprint } : {}),
          }),
        );
      } catch (error) {
        return mapError(error, 'machine');
      }
      if (!minted) return fail('failed');
      // A listener bound only to loopback advertises no hosts; without a
      // tailcat address either, no backend could reach the machine.
      if (minted.machine.hosts.length === 0 && !minted.machine.tcAddress) {
        await revoke(machine, minted.credentialId);
        return fail('listener-off');
      }

      let added: unknown;
      try {
        added = await backend.client.request(
          'remoteMachines.add',
          {
            machineId: minted.machine.daemonId,
            name: minted.machine.name,
            hosts: minted.machine.hosts,
            port: minted.machine.port,
            ...(minted.machine.tcAddress ? { tcAddress: minted.machine.tcAddress } : {}),
            fingerprint: minted.machine.fingerprint,
            credentialId: minted.credentialId,
            token: minted.token,
          },
          { timeoutMs: ADD_TIMEOUT_MS },
        );
      } catch (error) {
        const failure = mapError(error, 'backend');
        deps.logger.warn('remoteMachines.add failed; revoking the new credential', {
          code: failure.code,
        });
        await revoke(machine, minted.credentialId);
        return failure;
      }
      const result = record(added) ? added : {};
      if (text(result.replacedCredentialId)) await revoke(machine, result.replacedCredentialId);
      const saved = parseRemoteMachine(result.machine);
      if (!saved) return fail('failed');
      deps.logger.info('Machine made available to the backend', { machineId: saved.id });
      return { success: true, machine: saved };
    } catch (error) {
      if (error instanceof RelayRefusal) return error.failure;
      return mapError(error, 'machine');
    }
  }

  async function unexpose(
    params: RemoteMachineUnexposeParams,
    backend: RemoteMachineBackend,
  ): Promise<RemoteMachineUnexposeResult> {
    if (!backend.supportsRemoteMachines) return fail('unsupported-backend');
    let removed: unknown;
    try {
      removed = params.stopAgents
        ? await backend.client.request(
            'remoteMachines.remove',
            { machineId: params.machineId, stopAgents: true },
            { timeoutMs: REMOVE_STOP_AGENTS_TIMEOUT_MS },
          )
        : await backend.client.request('remoteMachines.remove', { machineId: params.machineId });
    } catch (error) {
      return mapError(error, 'backend');
    }
    const credentialId =
      record(removed) && text(removed.credentialId) ? removed.credentialId : null;
    if (!credentialId) return { success: true, revoked: false };
    const connectionId = params.machineConnectionId;
    if (!connectionId || connectionId === backend.connectionId)
      return { success: true, revoked: false };
    let machine: RemoteMachineRpcClient;
    try {
      machine = await ownerMachine(connectionId);
    } catch {
      return { success: true, revoked: false };
    }
    return { success: true, revoked: await revoke(machine, credentialId) };
  }

  async function machineFingerprint(connectionId: string): Promise<string | null> {
    const machine = deps.getMachineClient(connectionId);
    if (!machine) return null;
    try {
      return parsePairingRoutes(await machine.request('server.pairingInfo')).fingerprint;
    } catch {
      return null;
    }
  }

  return { expose, unexpose, machineFingerprint };
}
