/**
 * The New Workspace dialog's "Start On" row: which machine the first agent
 * runs on (PROTOCOL `methods/nodes.md` → "Placement subset",
 * `workspace.create.initialAgent.placement`). The current backend is the
 * default and is sent as an omitted placement; another machine is sent as the
 * closed `{ target: "remote", checkout: "isolated", nodeId }` object.
 */
import { m } from '$shared/paraglide/messages.js';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import type { RemoteMachine, RemoteMachineState } from '$shared/types/remote-machines';
import type { CloudProviderKind } from '$shared/types/cloud-machines';
import { machinePlatformLabel } from './agent-location';

/** The current backend: no placement. */
export const START_ON_BACKEND = '';
const CLOUD_PREFIX = 'cloud:';
/** The Start On id of a new machine from a cloud entry; never a daemon id. */
export function startOnCloudId(cloudMachineId: string): string {
  return `${CLOUD_PREFIX}${cloudMachineId}`;
}
/** The entry a Start On id names, or null for the backend or a machine. */
export function startOnCloudMachineId(id: string | undefined): string | null {
  return id?.startsWith(CLOUD_PREFIX) ? id.slice(CLOUD_PREFIX.length) || null : null;
}
/** The entry "e2b" (the only one an older backend keeps). */
export const START_ON_E2B = startOnCloudId('e2b');

export interface StartOnOption {
  /** Machine id, or `START_ON_BACKEND`. */
  id: string;
  label: string;
  platform: string | null;
  disabled: boolean;
  reason?: string;
  /** Secondary text for a usable row (the E2B profile hint). */
  hint?: string;
  /** `cloud` for an E2B entry row. */
  kind?: 'machine' | 'cloud';
}

/** One E2B entry row of Start On. */
export interface StartOnCloudEntry {
  cloudMachineId: string;
  /** "E2B · <name>", or the single-provider label from an older backend. */
  label: string;
  /** Null when usable, else why not. */
  unavailableReason: string | null;
  /** No configuration from here can be sent to it: show the profile hint. */
  needsProfile?: boolean;
}

/** The E2B rows; null or empty when cloud machines are not configured. */
export type StartOnCloud = readonly StartOnCloudEntry[];

function usableCloudEntry(
  cloud: StartOnCloud | null | undefined,
  id: string,
): StartOnCloudEntry | undefined {
  return cloud?.find(
    (entry) => startOnCloudId(entry.cloudMachineId) === id && entry.unavailableReason === null,
  );
}

/** Disconnected machines connect on demand; the other states can't start an agent. */
const USABLE_STATES = new Set<RemoteMachineState>(['connected', 'disconnected']);

function unusableReason(state: RemoteMachineState): string | undefined {
  switch (state) {
    case 'unreachable':
      return m.remoteMachines_state_unreachable_label();
    case 'revoked':
      return m.remoteMachines_state_revoked_label();
    case 'update-required':
      return m.remoteMachines_state_updateRequired_label();
    default:
      return undefined;
  }
}

function isStartOnMachineUsable(machine: RemoteMachine): boolean {
  return USABLE_STATES.has(machine.state);
}

/**
 * The backend first, then each machine available to it. On an orchestrator
 * the first row is not the backend, which never runs agents: an omitted
 * placement walks the ordered machine list, so the row reads "First available
 * machine" (PROTOCOL `methods/nodes.md` → "Orchestrator mode").
 */
export function startOnOptions({
  backendLabel,
  backendPlatform,
  machines,
  cloud,
  orchestrator = false,
}: {
  backendLabel: string;
  /** The backend's own host platform (`host.status` os/arch), when known. */
  backendPlatform?: { os?: string; arch?: string };
  machines: readonly RemoteMachine[];
  cloud?: StartOnCloud | null;
  /** The backend is an orchestrator: no "this machine" choice. */
  orchestrator?: boolean;
}): StartOnOption[] {
  const options: StartOnOption[] = [
    orchestrator
      ? {
          id: START_ON_BACKEND,
          label: m.remoteMachines_startOn_firstAvailable_label(),
          platform: null,
          disabled: false,
          hint: m.remoteMachines_startOn_firstAvailable_hint(),
        }
      : {
          id: START_ON_BACKEND,
          label: backendLabel,
          platform: machinePlatformLabel(backendPlatform?.os, backendPlatform?.arch),
          disabled: false,
        },
    ...machines.map((machine): StartOnOption => {
      const platform = machinePlatformLabel(machine.platform?.os, machine.platform?.arch);
      if (isStartOnMachineUsable(machine))
        return { id: machine.id, label: machine.name, platform, disabled: false };
      return {
        id: machine.id,
        label: machine.name,
        platform,
        disabled: true,
        reason: unusableReason(machine.state),
      };
    }),
  ];
  for (const entry of cloud ?? [])
    options.push({
      id: startOnCloudId(entry.cloudMachineId),
      label: entry.label,
      platform: null,
      kind: 'cloud',
      disabled: entry.unavailableReason !== null,
      ...(entry.unavailableReason
        ? { reason: entry.unavailableReason }
        : entry.needsProfile
          ? { hint: m.cloudMachines_startOn_hint() }
          : {}),
    });
  return options;
}

/**
 * The label of the omitted-placement row among Start On rows (not always first
 * with `machineOrder: 1`): the backend, or "First available machine" on an orchestrator.
 */
export function startOnBackendLabel(options: readonly StartOnOption[]): string {
  return options.find((option) => option.id === START_ON_BACKEND)?.label ?? '';
}

/**
 * The row shows only while the remote-machine surfaces are on (Labs flag and
 * `remoteMachines`), the backend accepts an initial-agent placement, and at
 * least one other machine can take the agent.
 */
export function startOnVisible({
  remoteMachinesVisible,
  supported,
  machines,
  cloud,
}: {
  remoteMachinesVisible: boolean;
  supported: boolean;
  machines: readonly RemoteMachine[];
  cloud?: StartOnCloud | null;
}): boolean {
  return (
    remoteMachinesVisible &&
    supported &&
    (machines.some(isStartOnMachineUsable) ||
      (cloud ?? []).some((entry) => entry.unavailableReason === null))
  );
}

/** A remembered machine while it is still usable, else the backend. */
export function resolveStartOn(
  remembered: string | undefined,
  machines: readonly RemoteMachine[],
  cloud?: StartOnCloud | null,
): string {
  if (!remembered) return START_ON_BACKEND;
  if (startOnCloudMachineId(remembered))
    return usableCloudEntry(cloud, remembered) ? remembered : START_ON_BACKEND;
  const machine = machines.find((row) => row.id === remembered);
  return machine && isStartOnMachineUsable(machine) ? machine.id : START_ON_BACKEND;
}

/**
 * `workspace.create.initialAgent.placement` for a choice; absent for the
 * backend. The entry is named only to a backend that keeps entries.
 */
export type StartOnPlacement =
  | { target: 'remote'; checkout: 'isolated'; nodeId: string }
  | { target: 'e2b' | 'cloud'; checkout: 'isolated'; cloudMachineId?: string };

export function initialAgentPlacement(
  machineId: string | undefined,
  {
    cloudEntries = false,
    providerOf,
  }: {
    cloudEntries?: boolean;
    /** The provider of a saved entry; a Northflank entry takes the provider-neutral target. */
    providerOf?: (cloudMachineId: string) => CloudProviderKind | undefined;
  } = {},
): StartOnPlacement | undefined {
  const cloudMachineId = startOnCloudMachineId(machineId);
  if (cloudMachineId) {
    if (cloudEntries && providerOf?.(cloudMachineId) === 'northflank')
      return { target: 'cloud', checkout: 'isolated', cloudMachineId };
    return cloudEntries
      ? { target: 'e2b', checkout: 'isolated', cloudMachineId }
      : { target: 'e2b', checkout: 'isolated' };
  }
  return machineId ? { target: 'remote', checkout: 'isolated', nodeId: machineId } : undefined;
}

/** The parts of a machine-scoped model-picker group the fallback reads. */
interface MachineModelGroup {
  key: string;
  options: readonly { value: string; disabled?: boolean }[];
}

/**
 * A model the chosen machine can run when the current choice can't run there
 * (the machine lacks the model or provider, or the configuration is greyed
 * out), or null to keep it. `groups` are the machine-scoped picker groups
 * (`buildMachineModelGroups`): group keys are provider refs, disabled rows
 * can't run on the machine. Prefers the same provider.
 */
export function machineModelFallback({
  groups,
  providerRef,
  model,
}: {
  groups: readonly MachineModelGroup[];
  providerRef: string;
  model: string | undefined;
}): { providerId: string; modelId: string } | null {
  const runnable = (group: MachineModelGroup) => group.options.filter((option) => !option.disabled);
  const current = groups.find((group) => group.key === providerRef);
  const currentRunnable = current ? runnable(current) : [];
  if (model) {
    const modelId = splitLegacyCompoundId(model).modelId;
    if (currentRunnable.some((option) => option.value === modelId)) return null;
  } else if (currentRunnable.length > 0) {
    return null;
  }
  if (current && currentRunnable.length > 0)
    return { providerId: current.key, modelId: currentRunnable[0].value };
  for (const group of groups) {
    if (group.key === 'default') continue;
    const options = runnable(group);
    if (options.length > 0) return { providerId: group.key, modelId: options[0].value };
  }
  return null;
}
