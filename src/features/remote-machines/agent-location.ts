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
import { AgentStatus, type AgentSession } from '$shared/types';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { parseCloudMachineError, type CloudMachineErrorData } from '$shared/types/cloud-machines';

/** Where an agent on E2B is in its sandbox's life. */
type AgentCloudState = 'starting' | 'running' | 'paused' | 'resuming' | 'pausing' | 'stopping';

type AgentMachineState = 'ready' | 'unreachable' | 'revoked';

export interface AgentMachineLocation {
  nodeId: string;
  name: string;
  /** "macOS arm64"; null when neither the agent nor the machine reports it. */
  platform: string | null;
  state: AgentMachineState;
  /** Agents on E2B: the sandbox state; absent for other machines or when unknown. */
  cloud?: { state: AgentCloudState | null };
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
  return agent?.placement?.target === 'remote' || agent?.placement?.target === 'e2b';
}

const CLOUD_STATES = new Set<string>(['running', 'paused', 'resuming', 'pausing', 'stopping']);

/** The sandbox state of an agent on E2B, from its start fields or its sandbox row. */
function agentCloudState(
  agent: AgentSession,
  machine: RemoteMachine | null,
): AgentCloudState | null {
  if (agent.placementError) return null;
  if (agent.cloudStart) return 'starting';
  if (!agent.nodeId) return agent.effectiveIsolation === 'pending' ? 'starting' : null;
  const state = machine?.cloud?.state;
  if (state && CLOUD_STATES.has(state)) return state as AgentCloudState;
  return agent.effectiveIsolation === 'pending' ? 'starting' : null;
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
  if (agent.placement?.target === 'e2b')
    return {
      nodeId,
      name: agent.nodeName?.trim() || 'E2B', // i18n-ignore (product name)
      platform: machinePlatformLabel(listed?.platform?.os, listed?.platform?.arch),
      // A paused sandbox drops its link on purpose: never "unreachable".
      state: 'ready',
      cloud: { state: agentCloudState(agent, listed) },
    };
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

/** "running", "paused", … for an agent on E2B; null when unknown. */
function cloudStateLabel(state: AgentCloudState | null | undefined): string | null {
  switch (state) {
    case 'starting':
      return m.cloudMachines_agent_starting();
    case 'running':
      return m.cloudMachines_agent_running();
    case 'paused':
      return m.cloudMachines_agent_paused();
    case 'resuming':
      return m.cloudMachines_agent_resuming();
    case 'pausing':
      return m.cloudMachines_agent_pausing();
    case 'stopping':
      return m.cloudMachines_agent_stopping();
    default:
      return null;
  }
}

/** "E2B · paused" for an agent on E2B, else the machine name. */
export function agentMachineChipLabel(location: AgentMachineLocation): string {
  const state = cloudStateLabel(location.cloud?.state);
  return state ? m.cloudMachines_agent_chip({ machine: location.name, state }) : location.name;
}

/** "Runs on Mac mini · macOS arm64", plus the machine state when it has one. */
export function agentMachineTooltip(location: AgentMachineLocation): string {
  if (location.cloud) {
    const state = cloudStateLabel(location.cloud.state);
    const where = m.remoteAgent_location_tooltipNoPlatform({ machine: location.name });
    return state ? m.remoteAgent_location_tooltipWithState({ location: where, state }) : where;
  }
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
  if (agent.effectiveIsolation === 'pending' || agent.cloudStart) return 'starting';
  if (agent.setup?.state === 'failed') return 'setup-failed';
  return null;
}

export interface PlacementFailure {
  message: string;
  /** The machine must update Intent before an agent can start there. */
  updateRequired: boolean;
  /** A cloud machine error (E2B), when the failure carries one. */
  cloud?: CloudMachineErrorData;
  /**
   * The cloud error came with its typed data (reason, limit). False when only
   * the code is known: then `message` (the backend's detail) says why.
   */
  cloudDetailKnown?: boolean;
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
  const typed = parseCloudMachineError(split?.data);
  const cloud = typed ?? (error.code ? parseCloudMachineError({ code: error.code }) : null);
  if (cloud)
    return { updateRequired, message: split?.message || detail, cloud, cloudDetailKnown: !!typed };
  return { updateRequired, message: split?.message || detail };
}

/**
 * The start failure of an agent on E2B with a cloud error while the agent is
 * parked in Error, or null. The chat shows it as the turn's failure card in
 * place of the generic one. A kept `placementError` after a retry started
 * (status no longer Error) is stale and yields null.
 */
export function agentCloudStartFailure(
  agent: AgentSession | null | undefined,
): PlacementFailure | null {
  if (
    agent?.placement?.target !== 'e2b' ||
    !agent.placementError ||
    agent.status !== AgentStatus.Error
  )
    return null;
  const failure = placementFailure(agent.placementError, '');
  return failure.cloud ? failure : null;
}

const ATTACHMENTS_TOO_LARGE_PREFIXES = [
  'attachments-too-large-for-machine:',
  'node-prompt-too-large:',
];
const REMOTE_AGENT_UNSUPPORTED_PREFIX = 'remote-agent-unsupported:';

function megabytes(bytes: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1048576);
}

/**
 * How a refused message with attachments to a remote agent reads (PROTOCOL
 * `workspace-routing.md` "Attachments"): too large for the machine link, or a
 * backend too old to send attachments to another machine. Null for any other
 * error, which the caller shows as it is.
 */
export function remoteAttachmentFailure(text: string): string | null {
  const message = splitErrorData(text)?.message ?? text;
  for (const prefix of ATTACHMENTS_TOO_LARGE_PREFIXES) {
    const at = message.indexOf(prefix);
    if (at < 0) continue;
    // The backend names the refused method first (`agent.sendMessage: …`).
    const detail = message
      .slice(at + prefix.length)
      .trim()
      .replace(/^[a-z][\w]*(?:\.[\w]+)+:\s*/i, '');
    const sizes = /come to (\d+) bytes\b.*?over its (\d+)-byte limit/.exec(detail);
    if (sizes)
      return m.remoteAgent_attachmentsTooLargeSized_error({
        size: megabytes(Number(sizes[1])),
        limit: megabytes(Number(sizes[2])),
      });
    return detail
      ? m.remoteAgent_attachmentsTooLarge_error({ detail })
      : m.remoteAgent_attachmentsTooLargeNoDetail_error();
  }
  const at = message.indexOf(REMOTE_AGENT_UNSUPPORTED_PREFIX);
  if (at >= 0 && /attachment/i.test(message.slice(at)))
    return m.remoteAgent_attachmentsUnsupported_error();
  return null;
}

/**
 * The agent's cloud machine (E2B) is still starting. The chat then shows the
 * start line in the working row, in place of the turn's phase line.
 */
export function agentCloudStarting(agent: AgentSession | null | undefined): boolean {
  return (
    agent?.placement?.target === 'e2b' &&
    agentPlacementNoticeKind(agent, agentMachineLocation(agent)) === 'starting'
  );
}
