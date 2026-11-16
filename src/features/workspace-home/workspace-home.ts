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
import { AgentStatus, WorkspaceStatusEnum, type AgentSession, type Workspace } from '$shared/types';
import type {
  KnownWorkspaceHomeState,
  MoveHomeTarget,
  WorkspaceHomeState,
} from '$shared/types/workspace-home';
import {
  START_ON_BACKEND,
  startOnCloudMachineId,
  type StartOnOption,
} from '$features/remote-machines/start-on';

/** Which banner the workspace shows; detached wins over a backup warning. */
type WorkspaceHomeBanner = 'detached' | 'moving' | 'backupWarning';

export interface WorkspaceHomeView {
  name: string;
  /** As served, including a state this app does not know. */
  state: WorkspaceHomeState;
  /** A cloud home's sandbox is starting: a calm "Starting home…", no banner or actions. */
  starting: boolean;
  /** A state this app does not know: unavailable, shown without backup or loss wording. */
  unknownState: boolean;
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

/**
 * How a served state is presented. A state this app does not know is
 * `unknown`: unavailable (panels covered, Run disabled) but neutral, with no
 * banner, marker, Wait or backup-loss warning, since a later backend's state
 * need not mean the machine is gone.
 */
function presentedState(state: WorkspaceHomeState): KnownWorkspaceHomeState | 'unknown' {
  switch (state) {
    case 'attached':
      return 'attached';
    case 'detached':
      return 'detached';
    case 'moving':
      return 'moving';
    case 'starting':
      return 'starting';
    default:
      return 'unknown';
  }
}

/** The home's view, or null when the workspace has none. */
export function workspaceHomeView(
  workspace: Pick<Workspace, 'home'> | null | undefined,
): WorkspaceHomeView | null {
  const home = workspace?.home;
  if (!home) return null;
  const presented = presentedState(home.state);
  const starting = presented === 'starting';
  const loud = presented === 'detached' || presented === 'moving';
  const banner: WorkspaceHomeBanner | null =
    presented === 'attached'
      ? home.backupWarning === true
        ? 'backupWarning'
        : null
      : loud
        ? presented
        : null;
  return {
    name: home.name,
    state: home.state,
    starting,
    unknownState: presented === 'unknown',
    unavailable: presented !== 'attached',
    lastBackupAt: home.lastBackupAt ?? null,
    banner,
    marker: loud ? presented : null,
    canWait: presented === 'detached',
    // Only a running move refuses another (`home-moving`).
    canMove: presented !== 'moving',
    // When the old home is attached the backend pushes first, so nothing is lost.
    moveWarning: presented === 'detached',
  };
}

/**
 * How long after a panel mounted on an attached home its own first read can
 * still be the one that woke a paused cloud home: the backend waits up to
 * 10 s for it to start, plus a margin.
 */
const HOME_WAKE_WINDOW_MS = 12_000;

/** A panel's retry bookkeeping while the home is starting (see `nextHomeRetry`). */
export interface HomeRetry {
  /** The workspace the panel shows; another one starts over. */
  workspaceId: string | null;
  /** Bumps once to remount the panel, so it re-reads from the now attached home. */
  generation: number;
  /** The panel has had a usable home since this time (ms), or null. */
  usableSince: number | null;
  /** The panel's reads may have failed while the home was unavailable. */
  waited: boolean;
}

export const initialHomeRetry: HomeRetry = {
  workspaceId: null,
  generation: 0,
  usableSince: null,
  waited: false,
};

/**
 * Retry once the home is attached (nodes.md "Cloud homes" 6). A panel
 * remounts once, to re-read, when its reads may have failed while the home
 * was unavailable: it opened while the home was starting, or the home went
 * away within `HOME_WAKE_WINDOW_MS` of the panel opening (its own read woke a
 * paused cloud home, which reports attached until then). A panel that
 * reported loaded content (`contentLoaded`, an editor) is never remounted,
 * nor is one that was usable longer: a remount must not drop undo history or
 * unsaved work. Nothing is decided until the workspace row is loaded; another
 * workspace starts over.
 */
export function nextHomeRetry(
  prev: HomeRetry,
  input: {
    workspaceId: string;
    loaded: boolean;
    unavailable: boolean;
    /** The panel reported that its content loaded (see `HomePanelContext`). */
    contentLoaded: boolean;
    now: number;
  },
): HomeRetry {
  if (!input.loaded) return prev;
  const base: HomeRetry =
    prev.workspaceId === input.workspaceId
      ? prev
      : { ...initialHomeRetry, workspaceId: input.workspaceId, generation: prev.generation };
  if (input.unavailable) {
    if (base.waited) return base;
    const freshlyMounted =
      base.usableSince === null || input.now - base.usableSince <= HOME_WAKE_WINDOW_MS;
    return freshlyMounted ? { ...base, usableSince: null, waited: true } : base;
  }
  if (base.waited) {
    return {
      ...base,
      generation: input.contentLoaded ? base.generation : base.generation + 1,
      usableSince: input.now,
      waited: false,
    };
  }
  return base.usableSince === null ? { ...base, usableSince: input.now } : base;
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
  /** Agents: that machine's id, to mark the current home's machine. */
  nodeId?: string;
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
  const agentOptions = agents.filter(hasLiveMachine).map((agent): MoveHomeOption => ({
    key: homeMoveTargetKey({ agentId: String(agent.id) }),
    kind: 'agent',
    label: agent.name,
    machineName: agent.nodeName?.trim() || undefined,
    nodeId: agent.nodeId,
    platform: null,
    disabled: false,
  }));
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

/** Why a call on the home failed (`home-unavailable`, PROTOCOL `09-error-codes.md`). */
export interface HomeUnavailableError {
  name: string;
  lastBackupAt: string | null;
  state: 'detached' | 'moving' | 'starting';
}

/**
 * The home state a failed call reports, or null when the error is not
 * `home-unavailable`. Takes a thrown `BackendError` or the `{ rpcCode, data }`
 * a read failure keeps in the store.
 */
export function homeUnavailableError(error: unknown): HomeUnavailableError | null {
  if (!error || typeof error !== 'object') return null;
  const { rpcCode, data } = error as { rpcCode?: unknown; data?: unknown };
  if (rpcCode !== -32603 || !data || typeof data !== 'object') return null;
  const fields = data as Record<string, unknown>;
  if (fields.code !== 'home-unavailable') return null;
  return {
    name: typeof fields.name === 'string' ? fields.name : '',
    lastBackupAt: typeof fields.lastBackupAt === 'string' ? fields.lastBackupAt : null,
    state: fields.starting === true ? 'starting' : fields.moving === true ? 'moving' : 'detached',
  };
}

/** The panel view of a failed call's home: its reason, without Wait. */
export function homeErrorView(error: HomeUnavailableError): WorkspaceHomeView {
  const view = workspaceHomeView({
    home: {
      homeId: '',
      name: error.name,
      state: error.state,
      since: '',
      ...(error.lastBackupAt ? { lastBackupAt: error.lastBackupAt } : {}),
    },
  })!;
  return { ...view, canWait: false };
}

/**
 * Panel tab types whose content reads the home checkout (files, diffs, git
 * changes) or runs on the home (terminals). While the home is detached or
 * moving they show the reason instead.
 */
const HOME_BACKED_TAB_TYPES = new Set([
  'file',
  'diff',
  'terminal',
  'changes',
  'local-changes',
  'code-review',
  'chat-changes',
  'activity-changes',
]);

function isHomeBackedTabType(type: string): boolean {
  return HOME_BACKED_TAB_TYPES.has(type);
}

/**
 * Whether a panel tab is covered while the home is away. A saved script's
 * output tab (a terminal tab with `scriptId`) stays readable: its output log
 * is kept on the orchestrator and is what diagnoses the failure; only its
 * Run control is disabled (see `TerminalTabType`).
 */
export function isHomeBackedTab(tab: { type: string; scriptId?: string }): boolean {
  if (tab.type === 'terminal' && tab.scriptId) return false;
  return isHomeBackedTabType(tab.type);
}

/**
 * The workspace menu offers Move home: a home that can move now, a viewer who
 * can manage the workspace, and not a purged (Retired) workspace, whose
 * surface shows no Move home dialog.
 */
export function moveHomeMenuVisible(
  workspace: Pick<Workspace, 'home' | 'status'> | null | undefined,
  canManage: boolean,
): boolean {
  return (
    canManage &&
    workspace?.status !== WorkspaceStatusEnum.Retired &&
    workspaceHomeView(workspace)?.canMove === true
  );
}
