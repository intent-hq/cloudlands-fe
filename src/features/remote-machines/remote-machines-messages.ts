import { m } from '$shared/paraglide/messages.js';
import { formatBytesBinary, formatInteger, formatNumber } from '$lib/i18n/format';
import { getActiveLocale } from '$lib/i18n/locale';
import { machineRowLoad, machineRowResources } from './machine-facts';
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
    case 'machine-unreachable': {
      const unconfirmed = failure.unconfirmedStops?.length ?? 0;
      if (unconfirmed === 0)
        return m.remoteMachines_failure_unreachable_error({ machine, backend });
      const count = formatInteger(unconfirmed);
      return unconfirmed === 1
        ? m.remoteMachines_failure_unconfirmedStops_error_one({ count, machine, backend })
        : m.remoteMachines_failure_unconfirmedStops_error_many({ count, machine, backend });
    }
    case 'machine-in-use': {
      const count = failure.runningAgents ?? 0;
      return count === 1
        ? m.remoteMachines_failure_inUse_error_one({ count: formatInteger(count), machine })
        : m.remoteMachines_failure_inUse_error_many({ count: formatInteger(count), machine });
    }
    case 'machine-orchestrator':
      return m.remoteMachines_failure_orchestrator_error({ machine, backend });
    case 'failed':
      return m.remoteMachines_failure_generic_error({
        message: failure.message ?? m.workspace_transfer_unknown_error(),
      });
  }
}

/**
 * The removal retry a failure offers: `stop-agents` after `machine-in-use`, or
 * `retry-stop-agents` after `remove` with `stopAgents` left stops unconfirmed
 * (the backend deleted nothing, so retrying is safe).
 */
export function remoteMachineFailureRetry(
  failure: RemoteMachineFailure,
): 'stop-agents' | 'retry-stop-agents' | null {
  if (failure.code === 'machine-in-use') return 'stop-agents';
  if (failure.code === 'machine-unreachable' && (failure.unconfirmedStops?.length ?? 0) > 0)
    return 'retry-stop-agents';
  return null;
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

interface MachineProblem {
  label: string;
  color: 'amber' | 'red';
}

export function remoteMachineProblem(machine: RemoteMachine): MachineProblem | null {
  switch (machine.state) {
    case 'revoked':
      return { label: m.remoteMachines_state_revoked_label(), color: 'red' };
    case 'unreachable':
      return { label: m.remoteMachines_state_unreachable_label(), color: 'amber' };
    case 'update-required':
      return { label: m.remoteMachines_state_updateRequired_label(), color: 'amber' };
    default:
      return null;
  }
}

export interface RunnerConnectionStatus {
  label: string;
  color?: MachineProblem['color'];
  description?: string | null;
}

export function runnerConnectionStatus(
  machine: RemoteMachine,
  labels: Labels,
): RunnerConnectionStatus {
  const problem = remoteMachineProblem(machine);
  if (problem) {
    return { ...problem, description: remoteMachineStateMessage(machine, labels) };
  }
  return {
    label:
      machine.state === 'connected'
        ? m.settings_devices_statusConnected_label()
        : m.remoteMachines_state_idle_label(),
  };
}

export function runningAgentsLabel(count: number): string {
  return count === 1
    ? m.remoteMachines_agents_running_one({ count: formatInteger(count) })
    : m.remoteMachines_agents_running_many({ count: formatInteger(count) });
}

/** One label and short value in a machine row's tooltip. */
export interface MachineFact {
  label: string;
  value: string;
  /** Shown with the orange dot, such as an outdated version. */
  warning?: boolean;
}

function ofValue(used: string, total: string): string {
  return m.remoteMachines_details_ofValue({ used, total });
}

/** A runner's agents, CPU and memory; empty when it reports none. */
export function machineLoadFacts(machine: RemoteMachine | null): MachineFact[] {
  const load = machineRowLoad(machine);
  const resources = machineRowResources(machine);
  const facts: MachineFact[] = [];
  if (load)
    facts.push({
      label: m.remoteMachines_details_agents_label(),
      value: ofValue(formatInteger(load.runningAgents), formatInteger(load.agentCap)),
    });
  if (resources?.cpuPercent !== undefined)
    facts.push({
      label: m.remoteMachines_details_cpu_label(),
      value: formatNumber(resources.cpuPercent / 100, {
        style: 'percent',
        maximumFractionDigits: 0,
      }),
    });
  if (resources)
    facts.push({
      label: m.remoteMachines_details_memory_label(),
      value: ofValue(
        formatBytesBinary(resources.memoryUsedBytes),
        formatBytesBinary(resources.memoryTotalBytes),
      ),
    });
  return facts;
}

/** The providers Node.js would unlock on a runner with none ready. */
export function needsNodeFact(needsNode: string[]): MachineFact | null {
  if (needsNode.length === 0) return null;
  return {
    label: m.remoteMachines_needsNode_label(),
    value: new Intl.ListFormat(getActiveLocale(), { style: 'long', type: 'conjunction' }).format(
      needsNode,
    ),
  };
}
