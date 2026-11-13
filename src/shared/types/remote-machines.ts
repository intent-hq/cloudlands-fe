import { parseCloudMachineState, type CloudMachineState } from './cloud-machines';

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
  /** Present only when false: the machine's provider gate hides it (env var / feature code). */
  visible?: false;
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
  /**
   * Executor-link version negotiated at the machine's last bind, kept while it
   * is disconnected; absent before the first bind (`remoteScripts: 1` backends).
   */
  nodeProtocol?: number;
  observedAt?: string;
  addedAt: string;
  lastConnectedAt?: string;
  /** Only on cloud machine rows (`cloudMachines.list`, `cloudMachine:changed`). */
  cloud?: CloudMachineState;
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
                ...(provider.visible === false ? { visible: false as const } : {}),
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
  const cloud = parseCloudMachineState(value.cloud);
  const nodeProtocol =
    Number.isInteger(value.nodeProtocol) && (value.nodeProtocol as number) >= 0
      ? (value.nodeProtocol as number)
      : undefined;
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
    ...(nodeProtocol !== undefined ? { nodeProtocol } : {}),
    ...(observedAt ? { observedAt } : {}),
    addedAt: value.addedAt,
    ...(lastConnectedAt ? { lastConnectedAt } : {}),
    ...(cloud ? { cloud } : {}),
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
  // Bridge replies are untyped at runtime; anything but a string is no fingerprint.
  const key = (typeof fingerprint === 'string' ? fingerprint : '').trim().toUpperCase();
  return key === '' ? null : key;
}

/**
 * One row of the backend's ordered machine list (PROTOCOL `methods/nodes.md` →
 * "Ordered machine list", `machineOrder: 1`): "This computer", an exposed
 * machine by `nodeId`, or a cloud entry by `cloudMachineId`. First = most preferred.
 */
export type MachineOrderRow =
  | { kind: 'local'; name: string }
  | { kind: 'machine'; nodeId: string; name: string }
  | { kind: 'cloud'; cloudMachineId: string; name: string };

/** `remoteMachines.setOrder` names each row by its key alone. */
export type MachineOrderKey =
  | { kind: 'local' }
  | { kind: 'machine'; nodeId: string }
  | { kind: 'cloud'; cloudMachineId: string };

/** Narrow one wire `MachineOrderRow`; null for an unknown kind or missing id. */
function parseMachineOrderRow(value: unknown): MachineOrderRow | null {
  if (!record(value) || typeof value.name !== 'string') return null;
  const name = value.name;
  if (value.kind === 'local') return { kind: 'local', name };
  if (value.kind === 'machine' && text(value.nodeId))
    return { kind: 'machine', nodeId: value.nodeId, name };
  if (value.kind === 'cloud' && text(value.cloudMachineId))
    return { kind: 'cloud', cloudMachineId: value.cloudMachineId, name };
  return null;
}

/**
 * Narrow a wire `MachineOrderRow[]`; null when `value` is not an array or names
 * a row this client can't read. `setOrder` must name every current row, so a
 * partial list could never be saved: the client keeps its older sections.
 */
export function parseMachineOrder(value: unknown): MachineOrderRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: MachineOrderRow[] = [];
  for (const row of value) {
    const parsed = parseMachineOrderRow(row);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return rows;
}

/** The key that names `row` in `remoteMachines.setOrder`. */
export function machineOrderKey(row: MachineOrderRow): MachineOrderKey {
  if (row.kind === 'local') return { kind: 'local' };
  if (row.kind === 'machine') return { kind: 'machine', nodeId: row.nodeId };
  return { kind: 'cloud', cloudMachineId: row.cloudMachineId };
}

/** A stable string id for a row: `local`, `machine:<nodeId>` or `cloud:<cloudMachineId>`. */
export function machineOrderId(row: MachineOrderRow | MachineOrderKey): string {
  if (row.kind === 'local') return 'local';
  return row.kind === 'machine' ? `machine:${row.nodeId}` : `cloud:${row.cloudMachineId}`;
}
