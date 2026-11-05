/**
 * Where a remote agent runs (PROTOCOL `methods/nodes.md` placed-agent
 * projection): the machine's name, platform and state for the agent row,
 * the panel header chip, the conversation notices and the locked model
 * picker. Local agents have no location.
 *
 * The agent's own fields (`nodeName`, `placement.os/arch`, `nodeState`) are
 * enough to show where existing work runs, so badges show with the Labs flag
 * off. `remoteMachines.list` (loaded only while the flag is on) adds the
 * platform when the placement omits it and is the only source of "access
 * revoked": the agent's `nodeState` only says `offline`.
 */
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import type { RemoteMachine } from '$shared/types/remote-machines';

type AgentMachineState = 'ready' | 'unreachable' | 'revoked';

export interface AgentMachineLocation {
  nodeId: string;
  name: string;
  /** "macOS arm64"; null when neither the agent nor the machine reports it. */
  platform: string | null;
  state: AgentMachineState;
}

export type AgentPlacementNoticeKind =
  'starting' | 'failed' | 'unreachable' | 'revoked' | 'setup-failed';

// Product and architecture names are not translated.
const OS_LABELS: Record<string, string> = {
  macos: 'macOS', // i18n-ignore (product name)
  linux: 'Linux', // i18n-ignore (product name)
  windows: 'Windows', // i18n-ignore (product name)
};
const ARCH_LABELS: Record<string, string> = {
  aarch64: 'arm64', // i18n-ignore (architecture name)
  arm64: 'arm64', // i18n-ignore (architecture name)
  x86_64: 'x64', // i18n-ignore (architecture name)
  x64: 'x64', // i18n-ignore (architecture name)
};

export function machinePlatformLabel(os?: string, arch?: string): string | null {
  const parts = [os && (OS_LABELS[os] ?? os), arch && (ARCH_LABELS[arch] ?? arch)].filter(
    (part): part is string => !!part,
  );
  return parts.length ? parts.join(' ') : null;
}

/** True when the agent is placed on another machine. */
function isRemoteAgent(agent: AgentSession | null | undefined): boolean {
  return agent?.placement?.target === 'remote';
}

/**
 * Where `agent` runs, or null for a local agent. `machine` is the
 * `remoteMachines.list` row for the agent's `nodeId`, when loaded.
 */
export function agentMachineLocation(
  agent: AgentSession | null | undefined,
  machine?: RemoteMachine | null,
): AgentMachineLocation | null {
  if (!agent || !isRemoteAgent(agent)) return null;
  const nodeId = agent.nodeId ?? agent.placement?.nodeId ?? '';
  const listed = machine && machine.id === nodeId ? machine : null;
  const platform =
    machinePlatformLabel(agent.placement?.os, agent.placement?.arch) ??
    machinePlatformLabel(listed?.platform?.os, listed?.platform?.arch);
  const state: AgentMachineState =
    listed?.state === 'revoked'
      ? 'revoked'
      : listed?.state === 'unreachable' || agent.nodeState === 'offline'
        ? 'unreachable'
        : 'ready';
  return {
    nodeId,
    name: agent.nodeName?.trim() || listed?.name || m.remoteAgent_location_unknownMachine(),
    platform,
    state,
  };
}

/**
 * Where an agent that is not created yet will run: the machine chosen for it
 * (New Workspace → Start On), from its `remoteMachines.list` row. Null for none.
 */
export function machineLocation(
  nodeId: string,
  machine?: RemoteMachine | null,
): AgentMachineLocation | null {
  if (!nodeId) return null;
  const listed = machine && machine.id === nodeId ? machine : null;
  return {
    nodeId,
    name: listed?.name || m.remoteAgent_location_unknownMachine(),
    platform: machinePlatformLabel(listed?.platform?.os, listed?.platform?.arch),
    state:
      listed?.state === 'revoked'
        ? 'revoked'
        : listed?.state === 'unreachable'
          ? 'unreachable'
          : 'ready',
  };
}

/** "Runs on Mac mini · macOS arm64", plus the machine state when it has one. */
export function agentMachineTooltip(location: AgentMachineLocation): string {
  const where = location.platform
    ? m.remoteAgent_location_tooltip({ machine: location.name, platform: location.platform })
    : m.remoteAgent_location_tooltipNoPlatform({ machine: location.name });
  switch (location.state) {
    case 'unreachable':
      return m.remoteAgent_location_tooltipWithState({
        location: where,
        state: m.remoteMachines_state_unreachable_label(),
      });
    case 'revoked':
      return m.remoteAgent_location_tooltipWithState({
        location: where,
        state: m.remoteMachines_state_revoked_label(),
      });
    default:
      return where;
  }
}

/**
 * The conversation notice for a remote agent: it could not start, its machine
 * revoked access or can't be reached, or it is still starting. Null when it
 * runs normally (and for local agents).
 */
export function agentPlacementNoticeKind(
  agent: AgentSession | null | undefined,
  location: AgentMachineLocation | null,
): AgentPlacementNoticeKind | null {
  if (!agent || !location) return null;
  if (agent.placementError) return 'failed';
  if (location.state === 'revoked') return 'revoked';
  if (location.state === 'unreachable') return 'unreachable';
  if (agent.effectiveIsolation === 'pending') return 'starting';
  if (agent.setup?.state === 'failed') return 'setup-failed';
  return null;
}

export interface PlacementFailure {
  message: string;
  /** The machine must update Intent before an agent can start there. */
  updateRequired: boolean;
}

/**
 * The typed error data the backend appends to an error's text (`"<message>
 * {\"code\":…}"`), split off; null when the text has none.
 */
function splitErrorData(text: string): { message: string; data: Record<string, unknown> } | null {
  if (!text.endsWith('}')) return null;
  for (let at = text.indexOf(' {'); at >= 0; at = text.indexOf(' {', at + 1)) {
    try {
      const data: unknown = JSON.parse(text.slice(at + 1));
      if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string')
        return { message: text.slice(0, at).trim(), data: data as Record<string, unknown> };
    } catch {
      // Not the data object; try the next brace.
    }
  }
  return null;
}

/**
 * How a remote agent's start failure reads: its detail without the appended
 * error data, and `machine-update-required` (PROTOCOL `methods/nodes.md`
 * "Remote machine errors") in the app's words when the machine can't prepare
 * the workspace's checkout.
 */
export function placementFailure(
  error: { code?: string; detail?: string },
  machine: string,
): PlacementFailure {
  const detail = error.detail ?? '';
  const split = splitErrorData(detail);
  const updateRequired =
    error.code === 'machine-update-required' || split?.data.code === 'machine-update-required';
  if (updateRequired && split?.data.reason === 'prepared-checkout')
    return { updateRequired, message: m.remoteAgent_updateRequired_preparedCheckout({ machine }) };
  return { updateRequired, message: split?.message || detail };
}
