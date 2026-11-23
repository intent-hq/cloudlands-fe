/**
 * The New Workspace dialog's "Start On" row: which machine the first agent
 * runs on (PROTOCOL `methods/nodes.md` → "Placement subset",
 * `workspace.create.initialAgent.placement`). The default is the first usable
 * row in the host's order; a default that lands on the host is an omitted
 * placement. The host picked explicitly is sent as `{ target: "local" }`, a
 * runner as the closed `{ target: "remote", checkout: "isolated", nodeId }` object.
 */
import { m } from '$shared/paraglide/messages.js';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import type { RemoteMachine, RemoteMachineState } from '$shared/types/remote-machines';
import type { CloudProviderKind } from '$shared/types/cloud-machines';
import { machinePlatformLabel } from './agent-location';

/**
 * No placement: the backend picks (it walks its ordered runner list). Also the
 * remembered value before the user chose, which follows {@link startOnDefault}.
 */
export const START_ON_BACKEND = '';
/** The host's own row, chosen explicitly: sent as `{ target: "local" }`. */
export const START_ON_HOST = 'host:';
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
  /** Runner id, a cloud id, or `START_ON_HOST`. */
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
 * The backend first, then each runner available to it. An orchestrator never
 * runs agents, so it has no row of its own: the user picks a runner, and the
 * picker preselects one with {@link startOnDefault}. An omitted placement still
 * walks the ordered list for API callers (PROTOCOL `methods/nodes.md` →
 * "Orchestrator mode").
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
  /** The backend is an orchestrator: no row of its own. */
  orchestrator?: boolean;
}): StartOnOption[] {
  const options: StartOnOption[] = [
    ...(orchestrator
      ? []
      : [
          {
            id: START_ON_HOST,
            label: backendLabel,
            platform: machinePlatformLabel(backendPlatform?.os, backendPlatform?.arch),
            disabled: false,
          },
        ]),
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
 * The label of the backend's row among Start On rows (not always first with
 * `machineOrder: 1`); `fallback` (the backend's name) on an orchestrator,
 * which has no row.
 */
export function startOnBackendLabel(options: readonly StartOnOption[], fallback = ''): string {
  return options.find((option) => option.id === START_ON_HOST)?.label ?? fallback;
}

/**
 * The preselected Start On row: the first usable row in the host's order from
 * Settings → Machines (the host itself when it runs agents and comes first; a
 * runner that can't take an agent is skipped). With nothing usable, the first
 * row, so the picker shows why it can't start; no placement without rows.
 */
export function startOnDefault(options: readonly StartOnOption[]): string {
  return (options.find((option) => !option.disabled) ?? options[0])?.id ?? START_ON_BACKEND;
}

/**
 * The machine whose models the Model row lists for a Start On choice: the
 * chosen machine, or on an orchestrator with "First available machine" the
 * first usable machine in the user's order (where the backend's walk starts;
 * an orchestrator has no models of its own). Undefined for the backend or a
 * cloud entry.
 */
export function startOnModelMachineId(
  effective: string,
  options: readonly StartOnOption[],
  orchestrator: boolean,
): string | undefined {
  if (effective === START_ON_HOST) return undefined;
  if (effective !== START_ON_BACKEND)
    return startOnCloudMachineId(effective) ? undefined : effective;
  if (!orchestrator) return undefined;
  return options.find(
    (option) => option.id !== START_ON_HOST && option.kind !== 'cloud' && !option.disabled,
  )?.id;
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

/** Start On rows with each cloud row's availability for the chosen model. */
export function startOnRowsWithCloud(
  rows: readonly StartOnOption[],
  cloud: StartOnCloud | null | undefined,
): StartOnOption[] {
  return rows.map((option) => {
    if (option.kind !== 'cloud') return option;
    const reason = cloud?.find(
      (entry) => startOnCloudId(entry.cloudMachineId) === option.id,
    )?.unavailableReason;
    return reason ? { ...option, disabled: true, reason, hint: undefined } : option;
  });
}

/**
 * A remembered choice while it is still usable, else the default: the first
 * usable row of `rows` (the ordered Start On rows, see {@link startOnDefault}),
 * or the backend without rows.
 */
export function resolveStartOn(
  remembered: string | undefined,
  machines: readonly RemoteMachine[],
  cloud?: StartOnCloud | null,
  rows?: readonly StartOnOption[],
): string {
  const fallback = rows ? startOnDefault(rows) : START_ON_BACKEND;
  // No choice yet follows the host's order.
  if (!remembered) return fallback;
  if (remembered === START_ON_HOST)
    return !rows || rows.some((row) => row.id === START_ON_HOST) ? START_ON_HOST : fallback;
  if (startOnCloudMachineId(remembered))
    return usableCloudEntry(cloud, remembered) ? remembered : fallback;
  const machine = machines.find((row) => row.id === remembered);
  return machine && isStartOnMachineUsable(machine) ? machine.id : fallback;
}

/**
 * The Start On id to submit: the effective row, except that a default that
 * lands on the host is sent as no placement, so the backend can still pass
 * over the host (a provider turned off there) as it walks its order. Only a
 * host the user picked is sent as `{ target: "local" }`.
 */
export function startOnSubmitted(chosen: string | undefined, effective: string): string {
  return effective === START_ON_HOST && chosen !== START_ON_HOST ? START_ON_BACKEND : effective;
}

/**
 * `workspace.create.initialAgent.placement` for a choice: `{ target: "local" }`
 * for the host's own row, absent for no choice (the backend picks). The entry is named only to a backend that keeps entries.
 */
export type StartOnPlacement =
  | { target: 'local' }
  | { target: 'remote'; checkout: 'isolated'; nodeId: string }
  | { target: 'e2b' | 'cloud'; checkout: 'isolated'; cloudMachineId?: string };

export function initialAgentPlacement(
  machineId: string | undefined,
  {
    cloudEntries = false,
    providerOf,
  }: {
    cloudEntries?: boolean;
    /** The provider of a saved entry; any but E2B takes the provider-neutral target. */
    providerOf?: (cloudMachineId: string) => CloudProviderKind | undefined;
  } = {},
): StartOnPlacement | undefined {
  // The host chosen explicitly: an omitted placement would walk the order.
  if (machineId === START_ON_HOST) return { target: 'local' };
  const cloudMachineId = startOnCloudMachineId(machineId);
  if (cloudMachineId) {
    const provider = providerOf?.(cloudMachineId);
    if (cloudEntries && provider && provider !== 'e2b')
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
