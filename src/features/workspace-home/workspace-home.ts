/**
 * Workspace homes (PROTOCOL `methods/nodes.md` → "Workspace homes"): on an
 * orchestrator each workspace has one home machine that holds its files,
 * terminals and scripts. `Workspace.home` is present only there, so every
 * home surface hides when it is absent.
 *
 * This module holds the pure state logic the banner, card marker, header
 * line, panels and Move home dialog share. It never re-derives what the
 * backend decides: `state`, `lastBackupAt` and `backupWarning` render as
 * served.
 */
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import type { MoveHomeTarget, WorkspaceHomeState } from '$shared/types/workspace-home';
import {
  START_ON_BACKEND,
  startOnCloudMachineId,
  type StartOnOption,
} from '$features/remote-machines/start-on';

/** Which banner the workspace shows; detached wins over a backup warning. */
export type WorkspaceHomeBanner = 'detached' | 'moving' | 'backupWarning';

export interface WorkspaceHomeView {
  name: string;
  state: WorkspaceHomeState;
  /** Files, diffs, terminals and scripts fail with `home-unavailable`. */
  unavailable: boolean;
  lastBackupAt: string | null;
  banner: WorkspaceHomeBanner | null;
  /** The marker on the workspace's card and row. */
  marker: 'detached' | 'moving' | null;
  /** Wait: ask the backend to reconnect the home. */
  canWait: boolean;
  /** A move may start (none is running); the caller still checks the role. */
  canMove: boolean;
  /** The Move home dialog warns that changes after the last backup stay behind. */
  moveWarning: boolean;
}

/** The home's view, or null when the workspace has none. */
export function workspaceHomeView(
  workspace: Pick<Workspace, 'home'> | null | undefined,
): WorkspaceHomeView | null {
  const home = workspace?.home;
  if (!home) return null;
  const { state } = home;
  const banner: WorkspaceHomeBanner | null =
    state === 'attached' ? (home.backupWarning === true ? 'backupWarning' : null) : state;
  return {
    name: home.name,
    state,
    unavailable: state !== 'attached',
    lastBackupAt: home.lastBackupAt ?? null,
    banner,
    marker: state === 'attached' ? null : state,
    canWait: state === 'detached',
    canMove: state !== 'moving',
    // When the old home is attached the backend pushes first, so nothing is lost.
    moveWarning: state === 'detached',
  };
}

const AGENT_PREFIX = 'agent:';
const MACHINE_PREFIX = 'machine:';
const CLOUD_PREFIX = 'cloud:';

/** A stable radio value for a target. */
export function homeMoveTargetKey(target: MoveHomeTarget): string {
  if ('agentId' in target) return `${AGENT_PREFIX}${target.agentId}`;
  if (target.kind === 'machine') return `${MACHINE_PREFIX}${target.nodeId}`;
  return `${CLOUD_PREFIX}${target.cloudMachineId}`;
}

/** The target a radio value names, or null. */
export function parseMoveHomeTargetKey(key: string): MoveHomeTarget | null {
  const rest = (prefix: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : '');
  if (rest(AGENT_PREFIX)) return { agentId: rest(AGENT_PREFIX) };
  if (rest(MACHINE_PREFIX)) return { kind: 'machine', nodeId: rest(MACHINE_PREFIX) };
  if (rest(CLOUD_PREFIX)) return { kind: 'cloud', cloudMachineId: rest(CLOUD_PREFIX) };
  return null;
}

export interface MoveHomeOption {
  key: string;
  kind: 'agent' | 'machine' | 'cloud';
  label: string;
  /** Agents: the machine or sandbox the agent runs on. */
  machineName?: string;
  platform: string | null;
  disabled: boolean;
  reason?: string;
}

/** The agent runs on a machine or sandbox the backend can reach now. */
function hasLiveMachine(agent: AgentSession): boolean {
  if (!agent.nodeId || agent.placementError) return false;
  if (agent.status === AgentStatus.Deleted || agent.retiredAt) return false;
  return agent.nodeState === undefined || agent.nodeState === 'ready';
}

/**
 * The Move home choices: the workspace's agents on a live machine first
 * (`{ agentId }` moves the home to that agent's machine or sandbox), then
 * every row of the ordered machine list. The backend validates the target;
 * rows it can't use keep their reason.
 */
export function moveHomeTargets({
  agents,
  machineRows,
}: {
  agents: readonly AgentSession[];
  machineRows: readonly StartOnOption[];
}): MoveHomeOption[] {
  const agentOptions = agents.filter(hasLiveMachine).map(
    (agent): MoveHomeOption => ({
      key: homeMoveTargetKey({ agentId: String(agent.id) }),
      kind: 'agent',
      label: agent.name,
      machineName: agent.nodeName?.trim() || undefined,
      platform: null,
      disabled: false,
    }),
  );
  const machineOptions = machineRows
    .filter((row) => row.id !== START_ON_BACKEND)
    .map((row): MoveHomeOption => {
      const cloudMachineId = startOnCloudMachineId(row.id);
      return {
        key: homeMoveTargetKey(
          cloudMachineId ? { kind: 'cloud', cloudMachineId } : { kind: 'machine', nodeId: row.id },
        ),
        kind: cloudMachineId ? 'cloud' : 'machine',
        label: row.label,
        platform: row.platform,
        disabled: row.disabled,
        ...(row.reason ? { reason: row.reason } : {}),
      };
    });
  return [...agentOptions, ...machineOptions];
}

/** The documented `workspace.setHome` refusals the dialog explains. */
export type SetHomeErrorCode =
  | 'forbidden'
  | 'homes-unsupported'
  | 'home-moving'
  | 'home-target-unavailable'
  | 'machine-update-required';

const SET_HOME_ERROR_CODES = new Set<string>([
  'homes-unsupported',
  'home-moving',
  'home-target-unavailable',
  'machine-update-required',
]);

/** The documented refusal a `workspace.setHome` error carries, or null. */
export function setHomeErrorCode(error: unknown): SetHomeErrorCode | null {
  if (!error || typeof error !== 'object') return null;
  const { rpcCode, data } = error as { rpcCode?: unknown; data?: unknown };
  if (rpcCode === -32003) return 'forbidden';
  const code = (data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && SET_HOME_ERROR_CODES.has(code)
    ? (code as SetHomeErrorCode)
    : null;
}

/**
 * Panel tab types whose content reads the home checkout (files, diffs, git
 * changes) or runs on the home (terminals). While the home is detached or
 * moving they show the reason instead.
 */
const HOME_BACKED_TAB_TYPES = new Set(['file', 'diff', 'terminal', 'changes', 'local-changes']);

export function isHomeBackedTabType(type: string): boolean {
  return HOME_BACKED_TAB_TYPES.has(type);
}
