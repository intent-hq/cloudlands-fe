import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import type { RemoteMachine, RemoteMachineFailure } from '$shared/types/remote-machines';

interface Labels {
  machine: string;
  backend: string;
}

/** User-facing text for a failed expose / un-expose / revoke. */
export function remoteMachineFailureMessage(failure: RemoteMachineFailure, labels: Labels): string {
  const { machine, backend } = labels;
  switch (failure.code) {
    case 'unsupported-backend':
      return m.remoteMachines_failure_unsupportedBackend_error({ backend });
    case 'same-machine':
      return m.remoteMachines_failure_sameMachine_error({ machine });
    case 'not-owner':
      return m.remoteMachines_failure_notOwner_error({ machine });
    case 'machine-not-connected':
      return m.remoteMachines_failure_notConnected_error({ machine });
    case 'listener-off':
      return m.remoteMachines_failure_listenerOff_error({ machine });
    case 'remote-agents-disabled':
      return m.remoteMachines_failure_disabled_error({ machine });
    case 'machine-update-required':
      if (failure.update === 'backend')
        return m.remoteMachines_failure_updateBackend_error({ machine, backend });
      return failure.machineVersion && failure.backendVersion
        ? m.remoteMachines_failure_updateMachineVersions_error({
            machine,
            machineVersion: failure.machineVersion,
            backendVersion: failure.backendVersion,
          })
        : m.remoteMachines_failure_updateMachine_error({ machine });
    case 'machine-unreachable':
      return m.remoteMachines_failure_unreachable_error({ machine, backend });
    case 'machine-in-use': {
      const count = failure.runningAgents ?? 0;
      return count === 1
        ? m.remoteMachines_failure_inUse_error_one({ count: formatInteger(count), machine })
        : m.remoteMachines_failure_inUse_error_many({ count: formatInteger(count), machine });
    }
    case 'failed':
      return m.remoteMachines_failure_generic_error({
        message: failure.message ?? m.workspace_transfer_unknown_error(),
      });
  }
}

/** Explanation for an exposed machine that cannot currently run agents, or null. */
export function remoteMachineStateMessage(machine: RemoteMachine, labels: Labels): string | null {
  switch (machine.state) {
    case 'revoked':
      return m.remoteMachines_state_revoked_description({ machine: labels.machine });
    case 'unreachable':
      return m.remoteMachines_state_unreachable_description(labels);
    case 'update-required':
      return m.remoteMachines_failure_updateMachine_error({ machine: labels.machine });
    default:
      return null;
  }
}

/** Short status badge text and colour for an exposed machine. */
export function remoteMachineBadge(
  machine: RemoteMachine,
  backend: string,
): { label: string; color: 'green' | 'amber' | 'red' } {
  switch (machine.state) {
    case 'revoked':
      return { label: m.remoteMachines_state_revoked_label(), color: 'red' };
    case 'unreachable':
      return { label: m.remoteMachines_state_unreachable_label(), color: 'amber' };
    case 'update-required':
      return { label: m.remoteMachines_state_updateRequired_label(), color: 'amber' };
    default:
      return { label: m.remoteMachines_state_available_label({ backend }), color: 'green' };
  }
}

export function runningAgentsLabel(count: number): string {
  return count === 1
    ? m.remoteMachines_agents_running_one({ count: formatInteger(count) })
    : m.remoteMachines_agents_running_many({ count: formatInteger(count) });
}
