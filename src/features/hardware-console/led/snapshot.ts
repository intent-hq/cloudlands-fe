/**
 * Store state → `HardwareLedSnapshot` derivation.
 *
 * Reads the resolved 6-slot key assignment (same pure resolver the
 * key-switch service uses) and maps each assigned workspace's BE-owned
 * `displayStatus` to an `AgentKeyLedState`, plus the ambient state over all
 * assignable workspaces.
 *
 * Dependency-light per src/store/renderer/AGENTS.md middleware conventions:
 * no selector imports — reads plain state through a narrow structural type
 * (`LedSnapshotState`, satisfied by the app `StoreState`).
 */

import { isWorkspaceDisplayStatus, type Workspace, type WorkspaceDisplayStatus } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { getItems, type Collection } from '$lib/store-shim/utils/collections/collection-utils';
import type { DaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { isKeyAssignableWorkspace, resolveKeySlots } from '../assignment/key-assignment';
import {
  AGENT_KEY_LED_COUNT,
  type AgentKeyLedState,
  type AmbientLedState,
  type HardwareLedSnapshot,
} from './frames';

/** The narrow slice of the app store state the LED derivation reads. */
export interface LedSnapshotState {
  workspace: { workspaces: Collection<Workspace, 'id'> };
  hardwareConsole: {
    keyPins: (string | null)[];
    excludedWorkspaceIds?: readonly string[];
    /** True while a push-to-talk recording is in progress. */
    pttRecording?: boolean;
  };
  /**
   * Daemon connection health (daemon-health slice). `'down'` means the
   * backend connection is lost (status disconnected/connecting), so all
   * store-derived lighting is stale. Optional so narrow test fixtures
   * default to connected.
   */
  daemonHealth?: { health: DaemonHealth };
}

/**
 * Wire `displayStatus` → LED palette row (spec "Agent-key LED palette").
 * Pure presentation mapping: the daemon owns the precedence (`failed` >
 * `blocked` > `needs_attention` > `in_progress` > `unread` > PR/task rollup,
 * PROTOCOL §5.1), so the LED never re-derives it from sessions. The four
 * PR/complete rollups share the green `complete` row and the two quiet
 * rollups share `idle`.
 */
const KEY_STATE_BY_DISPLAY_STATUS: Record<WorkspaceDisplayStatus, AgentKeyLedState> = {
  failed: 'failed',
  blocked: 'blocked',
  needs_attention: 'attention',
  in_progress: 'running',
  unread: 'unread',
  complete: 'complete',
  pr_ready: 'complete',
  pr_open: 'complete',
  pr_merged: 'complete',
  idle: 'idle',
  not_started: 'idle',
};

/**
 * Per-key state for one assigned workspace: the BE `displayStatus` mapped
 * verbatim onto the palette. An absent or unknown wire value renders `idle`
 * (the same treat-as-absent convention as `isWorkspaceDisplayStatus`).
 */
export function deriveAgentKeyLedState(workspace: Workspace): AgentKeyLedState {
  return isWorkspaceDisplayStatus(workspace.displayStatus)
    ? KEY_STATE_BY_DISPLAY_STATUS[workspace.displayStatus]
    : 'idle';
}

/** Build the full lighting snapshot (6 key states + ambient) from state. */
export function buildHardwareLedSnapshot(state: LedSnapshotState): HardwareLedSnapshot {
  // Daemon connection down → every store-derived state is stale: blank all
  // 6 keys and show only the disconnected snake (spec precedence row 1).
  // Recovers automatically once health leaves 'down' on reconnect.
  if (state.daemonHealth?.health === 'down') {
    return {
      keys: new Array<AgentKeyLedState>(AGENT_KEY_LED_COUNT).fill('unassigned'),
      ambient: { kind: 'disconnected' },
    };
  }

  const workspaces = getItems(state.workspace.workspaces).filter(
    (workspace) => workspace.id !== CHIEF_WORKSPACE_ID && isKeyAssignableWorkspace(workspace),
  );
  const byId = new Map<string, Workspace>();
  for (const workspace of workspaces) byId.set(workspace.id, workspace);

  const slots = resolveKeySlots(
    state.hardwareConsole.keyPins,
    workspaces,
    state.hardwareConsole.excludedWorkspaceIds ?? [],
  );
  const keys: AgentKeyLedState[] = slots.map((workspaceId) => {
    const workspace = workspaceId === null ? undefined : byId.get(workspaceId);
    if (!workspace) return 'unassigned';
    return deriveAgentKeyLedState(workspace);
  });

  // Ambient scans ALL assignable workspaces (not just the 6 assigned) over
  // the same per-workspace key states — i.e. the BE `displayStatus` verbatim.
  // Only the FLEET-WIDE ordering lives here (a presentation choice the single
  // per-workspace wire value cannot express): failed > blocked >
  // question/discussion > unread > running (breath speed ∝ count) > complete
  // > dark. `unread` outranks `running` so unseen output stays visible even
  // while other workspaces are still running; `complete` is terminal and only
  // wins once nothing is running. An in-progress push-to-talk recording
  // outranks everything.
  let anyFailed = false;
  let anyBlocked = false;
  let anyAttention = false;
  let runningCount = 0;
  let anyUnread = false;
  let anyComplete = false;
  for (const workspace of workspaces) {
    switch (deriveAgentKeyLedState(workspace)) {
      case 'failed':
        anyFailed = true;
        break;
      case 'blocked':
        anyBlocked = true;
        break;
      case 'attention':
        anyAttention = true;
        break;
      case 'running':
        runningCount += 1;
        break;
      case 'unread':
        anyUnread = true;
        break;
      case 'complete':
        anyComplete = true;
        break;
      default:
        break;
    }
  }
  let ambient: AmbientLedState;
  if (state.hardwareConsole.pttRecording === true) ambient = { kind: 'recording' };
  else if (anyFailed) ambient = { kind: 'failed' };
  else if (anyBlocked) ambient = { kind: 'blocked' };
  else if (anyAttention) ambient = { kind: 'question' };
  else if (anyUnread) ambient = { kind: 'unread' };
  else if (runningCount > 0) ambient = { kind: 'running', runningCount };
  else if (anyComplete) ambient = { kind: 'complete' };
  else ambient = { kind: 'dark' };

  return { keys, ambient };
}
