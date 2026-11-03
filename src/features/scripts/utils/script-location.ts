/**
 * Remote agents' runs of saved scripts (PROTOCOL `methods/scripts.md`,
 * "Scripts of remote agents", `remoteScripts: 1`). A remote agent that starts
 * a saved script runs it on its own machine as a separate run, listed in the
 * row's `machineRuns`; the row's `runtime` stays the backend's own run. When
 * the machine disconnects or is removed a run is lost: exited with exit code
 * -1 and the reason in `runtime.error` ("remote-script-lost: …").
 *
 * Dependency-light (no stores): the panel passes in the agent and the
 * machine's `remoteMachines.list` row.
 */
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import type { RemoteMachine } from '$shared/types/remote-machines';
import {
  machineLocation,
  machinePlatformLabel,
  type AgentMachineLocation,
} from '$features/remote-machines/agent-location';
import type { ScriptMachineRun, ScriptRuntimeState, ScriptStatus } from '../types';
import { getScriptStatusKind, type ScriptStatusKind } from './script-status';

/** Exit code of a run whose machine disconnected or was removed. */
const LOST_EXIT_CODE = -1;

/** Machine-readable prefix of a lost run's `runtime.error`. */
const LOST_REASON_PREFIX = /^remote-script-lost:\s*/;

const STATUSES: readonly ScriptStatus[] = ['idle', 'starting', 'running', 'restarting', 'exited'];

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function isMachineRun(value: unknown): value is ScriptMachineRun {
  return (
    record(value) &&
    nonempty(value.remoteAgentId) &&
    nonempty(value.nodeId) &&
    record(value.runtime) &&
    STATUSES.includes(value.runtime.status as ScriptStatus)
  );
}

/** The script's well-formed machine runs; empty for a backend-only script. */
export function scriptMachineRuns(script: { machineRuns?: unknown }): ScriptMachineRun[] {
  return Array.isArray(script.machineRuns) ? script.machineRuns.filter(isMachineRun) : [];
}

/**
 * The run's machine: its `remoteMachines.list` row first, else the remote
 * agent's own machine name and platform.
 */
export function machineRunLocation(
  run: Pick<ScriptMachineRun, 'nodeId'>,
  agent?: AgentSession | null,
  machine?: RemoteMachine | null,
): AgentMachineLocation {
  // A machine run always names its node (`scriptMachineRuns` drops runs without one).
  const location = machineLocation(run.nodeId, machine) ?? {
    nodeId: run.nodeId,
    name: m.remoteAgent_location_unknownMachine(),
    platform: null,
    state: 'ready' as const,
  };
  if (machine && machine.id === run.nodeId) return location;
  const own = agent?.nodeId === run.nodeId ? agent : null;
  return {
    ...location,
    name: own?.nodeName?.trim() || location.name,
    platform: machinePlatformLabel(own?.placement?.os, own?.placement?.arch),
  };
}

/** A machine run whose machine disconnected (or was removed) while it ran. */
export function isLostRun(runtime: Pick<ScriptRuntimeState, 'status' | 'exitCode'>): boolean {
  return runtime.status === 'exited' && runtime.exitCode === LOST_EXIT_CODE;
}

/**
 * Why a lost run stopped: the two documented reasons in the app language,
 * any other reported reason as sent (without the code prefix).
 */
export function scriptLostReason(runtime: Pick<ScriptRuntimeState, 'error'>): string {
  const reason = runtime.error?.trim().replace(LOST_REASON_PREFIX, '').trim();
  switch (reason) {
    case 'the machine disconnected': // i18n-ignore (wire reason, PROTOCOL methods/scripts.md)
      return m.scripts_remote_lostDisconnected_label();
    case 'the machine was removed': // i18n-ignore (wire reason, PROTOCOL methods/scripts.md)
      return m.scripts_remote_lostRemoved_label();
    default:
      return reason || m.scripts_remote_lostReason_fallback();
  }
}

export type MachineRunStatusKind = ScriptStatusKind | 'lost';

/** A machine run's status for the panel: "Lost: <reason>", or the usual script status. */
export function machineRunStatus(runtime: ScriptRuntimeState): {
  kind: MachineRunStatusKind;
  label: string;
} {
  if (isLostRun(runtime))
    return {
      kind: 'lost',
      label: m.scripts_remote_lost_tooltip({ reason: scriptLostReason(runtime) }),
    };
  const kind = getScriptStatusKind(runtime);
  switch (kind) {
    case 'running':
      return { kind, label: m.terminal_quakeOverlay_status_running() };
    case 'restarting':
      return { kind, label: m.workspace_devScripts_restarting_label() };
    case 'idle':
      return { kind, label: m.terminal_quakeOverlay_status_idle() };
    case 'succeeded':
      return { kind, label: m.terminal_quakeOverlay_status_exitedZero() };
    case 'failed':
      return {
        kind,
        label: m.terminal_quakeOverlay_status_errorCode({ code: runtime.exitCode ?? 1 }),
      };
    case 'stopped':
      return {
        kind,
        label: m.terminal_quakeOverlay_status_stoppedSignal({
          signal: (runtime.exitCode ?? 128) - 128,
        }),
      };
    default:
      return { kind, label: m.terminal_quakeOverlay_status_exited() };
  }
}
