/**
 * The New Workspace dialog's "Start On" row: which machine the first agent
 * runs on (PROTOCOL `methods/nodes.md` → "Placement subset",
 * `workspace.create.initialAgent.placement`). The current backend is the
 * default and is sent as an omitted placement; another machine is sent as the
 * closed `{ target: "remote", checkout: "isolated", nodeId }` object.
 */
import type { DropdownGroup } from '$lib/components/ui/dropdown';
import { m } from '$shared/paraglide/messages.js';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import type { RemoteMachine, RemoteMachineState } from '$shared/types/remote-machines';
import { machinePlatformLabel } from './agent-location';

/** The current backend: no placement. */
export const START_ON_BACKEND = '';

export interface StartOnOption {
  /** Machine id, or `START_ON_BACKEND`. */
  id: string;
  label: string;
  platform: string | null;
  disabled: boolean;
  reason?: string;
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

export function isStartOnMachineUsable(machine: RemoteMachine): boolean {
  return USABLE_STATES.has(machine.state);
}

/** The backend first, then each machine available to it. */
export function startOnOptions({
  backendLabel,
  machines,
}: {
  backendLabel: string;
  machines: readonly RemoteMachine[];
}): StartOnOption[] {
  return [
    { id: START_ON_BACKEND, label: backendLabel, platform: null, disabled: false },
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
}: {
  remoteMachinesVisible: boolean;
  supported: boolean;
  machines: readonly RemoteMachine[];
}): boolean {
  return remoteMachinesVisible && supported && machines.some(isStartOnMachineUsable);
}

/** A remembered machine while it is still usable, else the backend. */
export function resolveStartOn(
  remembered: string | undefined,
  machines: readonly RemoteMachine[],
): string {
  if (!remembered) return START_ON_BACKEND;
  const machine = machines.find((row) => row.id === remembered);
  return machine && isStartOnMachineUsable(machine) ? machine.id : START_ON_BACKEND;
}

/** `workspace.create.initialAgent.placement` for a choice; absent for the backend. */
export function initialAgentPlacement(
  machineId: string | undefined,
): { target: 'remote'; checkout: 'isolated'; nodeId: string } | undefined {
  return machineId ? { target: 'remote', checkout: 'isolated', nodeId: machineId } : undefined;
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
  groups: readonly DropdownGroup[];
  providerRef: string;
  model: string | undefined;
}): { providerId: string; modelId: string } | null {
  const runnable = (group: DropdownGroup) => group.options.filter((option) => !option.disabled);
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
