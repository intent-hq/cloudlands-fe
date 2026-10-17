import { installChatChangesRecovery } from '$features/file-tracking/chat-content-recovery';
import { installWorkspaceActivityRecovery } from './workspace-activity-recovery';
import { observeRecoveryActionIngress } from '$store/renderer/middlewares/event-recovery';
import { beginLifecycleMetadataMutation } from './lifecycle-metadata-recovery';
import { rendererEventRecovery } from './renderer-event-recovery';
import { installTaskListRecovery } from './task-list-recovery';
import type { RendererRecoveryScope } from './renderer-event-recovery';
import type { StoreState } from '$store/renderer/types';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { installAgentEventRecovery } from '$features/agent/agent-event-recovery';
import { installCollaborationRecovery } from '$features/presence/collaboration-recovery';
import { installFileEventRecovery } from '$features/file/file-event-recovery';
import { installScriptsRecovery } from '$features/scripts/scripts-event-recovery';
import { installWorktreeSnapshotsRecovery } from '$features/file-tracking/worktree-snapshots-recovery';
import { installGitContentRecovery } from '$features/file-tracking/git-content-recovery';
import { installSecondaryRootRecovery } from '$features/file-tracking/git-secondary-root-recovery';
import { installLifecycleMetadataRecovery } from './lifecycle-metadata-recovery';
import { installWorkspaceListRecovery } from './workspace-list-recovery';
import { installTerminalListRecovery } from './terminal-list-recovery';
import { installSkillsRecovery } from './skills-recovery';
import { retireWorkspaceAfterRecovery } from './daemon-events-bridge.client';
export interface RecoveryReduxStore {
  getState(): StoreState;
  dispatch(action: { type: string; [key: string]: unknown }): unknown;
  subscribe(listener: () => void): () => void;
}
/** Root-owned registration; each domain retains its captured scope and cleanup. */
export function installRendererRecoveryOwners(
  scope: RendererRecoveryScope,
  store: RecoveryReduxStore,
) {
  if (!selectPrincipalActionContext.select(store.getState())) return () => {};
  const stops: Array<() => void> = [];
  try {
    for (const install of [
      () => installWorkspaceListRecovery(scope, store, retireWorkspaceAfterRecovery),
      () => installAgentEventRecovery(scope, store),
      () => installCollaborationRecovery(scope, store),
      () => installFileEventRecovery(scope, store),
      () => installScriptsRecovery(scope, store),
      () => installWorktreeSnapshotsRecovery(scope, store),
      () => installGitContentRecovery(scope, store),
      () => installChatChangesRecovery(scope, store),
      () => installSecondaryRootRecovery(scope, store),
      () => installLifecycleMetadataRecovery(scope, store),
      () => installSkillsRecovery(scope, store),
      () => installTaskListRecovery(scope, store),
      () => installWorkspaceActivityRecovery(scope, store),
      () => installTerminalListRecovery(scope, store),
    ])
      stops.push(install());
    stops.push(
      observeRecoveryActionIngress((action) => {
        if (!scope.isCurrent()) return;
        const mutation = beginLifecycleMetadataMutation(action);
        if (!mutation) return;
        rendererEventRecovery.push(mutation.key);
        return () => mutation.finish();
      }),
    );
  } catch (error) {
    for (const stop of stops.reverse()) stop();
    throw error;
  }

  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
