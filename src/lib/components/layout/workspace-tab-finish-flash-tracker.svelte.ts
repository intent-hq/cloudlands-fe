import { untrack } from 'svelte';
import {
  resolveWorkspaceStatusState,
  type WorkspaceStatusPresentationInput,
} from '$lib/components/workspace/utils/workspace-status-presentation';
import {
  EMPTY_WORKSPACE_TAB_FINISH_FLASHES,
  nextWorkspaceTabFinishFlashExpiry,
  nextWorkspaceTabFinishFlashes,
} from './workspace-tab-finish-flash';

type TrackedTabs = [
  tabIds: readonly string[],
  workspaceById: ReadonlyMap<string, WorkspaceStatusPresentationInput>,
  currentWorkspaceId: string | null | undefined,
];

/**
 * Component-local "just finished" tab state with its own expiry timer.
 * Construct during component init: it owns an `$effect` over `tabs()`.
 */
export class TabFinishFlash {
  #flashes = $state(EMPTY_WORKSPACE_TAB_FINISH_FLASHES);
  #tick = $state(0);

  constructor(tabs: () => TrackedTabs) {
    $effect(() => this.#observe(...tabs()));
  }

  has(workspaceId: string): boolean {
    return this.#flashes.expiresAt.has(workspaceId);
  }

  #observe(...[tabIds, workspaceById, currentWorkspaceId]: TrackedTabs): (() => void) | undefined {
    void this.#tick;
    const observations = tabIds.flatMap((workspaceId) => {
      const workspace = workspaceById.get(workspaceId);
      if (!workspace) return [];
      const state = resolveWorkspaceStatusState(workspace);
      return [{ workspaceId, state, isCurrent: workspaceId === currentWorkspaceId }];
    });
    const now = Date.now();
    const next = nextWorkspaceTabFinishFlashes(
      untrack(() => this.#flashes),
      observations,
      now,
    );
    this.#flashes = next;
    const expiry = nextWorkspaceTabFinishFlashExpiry(next);
    if (expiry === null) return;
    const timer = setTimeout(() => this.#tick++, Math.max(0, expiry - now));
    return () => clearTimeout(timer);
  }
}
