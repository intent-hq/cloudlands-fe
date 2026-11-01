/**
 * Daemon-to-daemon remote machines (PROTOCOL `methods/nodes.md` →
 * "Daemon-to-daemon remote machines").
 *
 * An owner makes one of their machines available to the current backend: the
 * main process mints a scoped executor credential on the machine and hands it
 * to the backend (`remoteMachines.add`). The executor token only ever lives in
 * the main process for the duration of that relay — none of the types below
 * carry it, so nothing that crosses renderer IPC or lands in Redux can hold it.
 */

export type RemoteMachineState =
  'connected' | 'disconnected' | 'unreachable' | 'revoked' | 'update-required';

const REMOTE_MACHINE_STATES: readonly RemoteMachineState[] = [
  'connected',
  'disconnected',
  'unreachable',
  'revoked',
  'update-required',
];

interface RemoteMachinePlatform {
  os: string;
  arch: string;
}

/** One provider in the machine's last capabilities report (node-link.md). */
interface RemoteMachineProvider {
  id: string;
  status: string;
  models: string[];
}

interface RemoteMachineCapabilities {
  intentdVersion?: string;
  providers: RemoteMachineProvider[];
}

/** `RemoteMachine` from `remoteMachines.list` / `add` / `refresh` (no token, ever). */
export interface RemoteMachine {
  id: string;
  name: string;
  platform?: RemoteMachinePlatform;
  hosts: string[];
  port: number;
  tcAddress?: string;
  fingerprint: string;
  state: RemoteMachineState;
  runningAgents: number;
  capabilities?: RemoteMachineCapabilities;
  observedAt?: string;
  addedAt: string;
  lastConnectedAt?: string;
}

/** One `executor.list` entry: a backend this machine is available to. */
export interface ExecutorBackend {
  credentialId: string;
  backendId: string;
  backendName: string;
  createdAt: string;
  lastUsedAt?: string;
  connected: boolean;
  runningAgents: number;
}

/** Which listener the expose flow may turn on for the local machine first. */
export type RemoteMachineListener = 'wss' | 'tailcat';

/** `remote-machines:expose` params. */
export interface RemoteMachineExposeParams {
  /** Saved owner connection (`backend-connections.json` id) of the machine to expose. */
  machineConnectionId: string;
  /** User-confirmed listener to turn on first (local machine only). */
  enableListener?: RemoteMachineListener;
}

/** `remote-machines:unexpose` params. */
export interface RemoteMachineUnexposeParams {
  machineId: string;
  /** Saved connection of the machine, when known, to revoke the credential there. */
  machineConnectionId?: string;
  stopAgents?: boolean;
}

export type RemoteMachineFailureCode =
  | 'unsupported-backend'
  | 'same-machine'
  | 'not-owner'
  | 'machine-not-connected'
  | 'listener-off'
  | 'remote-agents-disabled'
  | 'machine-update-required'
  | 'machine-unreachable'
  | 'machine-in-use'
  | 'failed';

export interface RemoteMachineRouteAttempt {
  route: string;
  error: string;
}

export interface RemoteMachineFailure {
  success: false;
  code: RemoteMachineFailureCode;
  /** Daemon-supplied message (never contains the token); absent for client-side refusals. */
  message?: string;
  /** `machine-unreachable`: the routes the backend tried. */
  attempts?: RemoteMachineRouteAttempt[];
  /**
   * `machine-unreachable` from `remove` with `stopAgents`: agent ids whose stop
   * the machine has not acknowledged. Nothing was removed; retrying is safe.
   */
  unconfirmedStops?: string[];
  /** `machine-update-required`: which side needs the update. */
  update?: 'machine' | 'backend';
  machineVersion?: string;
  backendVersion?: string;
  /** `machine-in-use`: live agents on the machine. */
  runningAgents?: number;
}

export type RemoteMachineExposeResult =
  { success: true; machine: RemoteMachine } | RemoteMachineFailure;

export type RemoteMachineUnexposeResult =
  | {
      success: true;
      /** False when the credential could not be revoked on the machine (offline, not saved). */
      revoked: boolean;
    }
  | RemoteMachineFailure;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;
const count = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;

function parseCapabilities(value: unknown): RemoteMachineCapabilities | undefined {
  if (!record(value)) return undefined;
  const providers = Array.isArray(value.providers)
    ? value.providers.flatMap((provider): RemoteMachineProvider[] =>
        record(provider) && text(provider.id)
          ? [
              {
                id: provider.id,
                status: typeof provider.status === 'string' ? provider.status : 'unknown',
                models: Array.isArray(provider.models)
                  ? provider.models.filter((model): model is string => text(model))
                  : [],
              },
            ]
          : [],
      )
    : [];
  const intentdVersion = optionalText(value.intentdVersion);
  return { ...(intentdVersion ? { intentdVersion } : {}), providers };
}

/** Narrow one wire `RemoteMachine`; drops any field it does not know (tokens included). */
export function parseRemoteMachine(value: unknown): RemoteMachine | null {
  if (!record(value) || !text(value.id) || !text(value.name) || !text(value.fingerprint))
    return null;
  if (!REMOTE_MACHINE_STATES.includes(value.state as RemoteMachineState)) return null;
  if (!Number.isInteger(value.port) || !text(value.addedAt)) return null;
  const platform =
    record(value.platform) && text(value.platform.os) && text(value.platform.arch)
      ? { os: value.platform.os, arch: value.platform.arch }
      : undefined;
  const capabilities = parseCapabilities(value.capabilities);
  const tcAddress = optionalText(value.tcAddress);
  const observedAt = optionalText(value.observedAt);
  const lastConnectedAt = optionalText(value.lastConnectedAt);
  return {
    id: value.id,
    name: value.name,
    ...(platform ? { platform } : {}),
    hosts: Array.isArray(value.hosts)
      ? value.hosts.filter((host): host is string => text(host))
      : [],
    port: value.port as number,
    ...(tcAddress ? { tcAddress } : {}),
    fingerprint: value.fingerprint,
    state: value.state as RemoteMachineState,
    runningAgents: count(value.runningAgents),
    ...(capabilities ? { capabilities } : {}),
    ...(observedAt ? { observedAt } : {}),
    addedAt: value.addedAt,
    ...(lastConnectedAt ? { lastConnectedAt } : {}),
  };
}

/** Narrow one `executor.list` backend entry. */
export function parseExecutorBackend(value: unknown): ExecutorBackend | null {
  if (
    !record(value) ||
    !text(value.credentialId) ||
    !text(value.backendId) ||
    !text(value.backendName) ||
    !text(value.createdAt)
  )
    return null;
  const lastUsedAt = optionalText(value.lastUsedAt);
  return {
    credentialId: value.credentialId,
    backendId: value.backendId,
    backendName: value.backendName,
    createdAt: value.createdAt,
    ...(lastUsedAt ? { lastUsedAt } : {}),
    connected: value.connected === true,
    runningAgents: count(value.runningAgents),
  };
}

/** Normalized fingerprint key (trimmed, upper-case) for matching a machine to a saved connection. */
export function fingerprintKey(fingerprint: string | null | undefined): string | null {
  const key = (fingerprint ?? '').trim().toUpperCase();
  return key === '' ? null : key;
}
