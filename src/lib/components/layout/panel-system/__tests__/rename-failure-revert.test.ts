/**
 * Regression tests for the rename-failure revert path used by
 * `PanelLayout.svelte` and `AgentCard.svelte`.
 *
 * When `agentService.renameSession` rejects, both call sites used to discard
 * the promise with `void`, leaving the optimistic Redux/tab-title update in
 * place while disk kept the old name. These tests reproduce the fixed handler
 * logic against the real `renameWithUndo` + `reversibleActions.execute`
 * pipeline and assert that on rejection:
 *   1. The optimistic Redux dispatch is reverted to the previous name +
 *      `nameExplicitlySet`.
 *   2. The tab title is reverted via `layoutManager.updateTabTitle`.
 *   3. `renameWithUndo` resolves to `false` so `toast.error` fires instead of
 *      the undo toast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('svelte-sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { toast } from 'svelte-sonner';
import { renameWithUndo, reversibleActions } from '$lib/utils/reversible-actions';

/**
 * Reproduces the `handleTabRename` agent branch from PanelLayout.svelte
 * without mounting the Svelte component. The captured dispatch / updateTabTitle
 * spies stand in for `getReduxStore().dispatch` and
 * `layoutManager.updateTabTitle`.
 */
function runAgentRenameWithUndo(opts: {
  agentId: string;
  tabId: string;
  oldName: string;
  newName: string;
  dispatch: (agentId: string, updates: Record<string, unknown>) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  renameSession: (agentId: string, newName: string) => Promise<void>;
}) {
  const { agentId, tabId, oldName, newName, dispatch, updateTabTitle, renameSession } = opts;
  return renameWithUndo(
    'agent',
    oldName,
    newName,
    async () => {
      dispatch(agentId, { name: newName, nameExplicitlySet: true });
      updateTabTitle(tabId, newName);
      try {
        await renameSession(agentId, newName);
      } catch (err) {
        dispatch(agentId, { name: oldName, nameExplicitlySet: true });
        updateTabTitle(tabId, oldName);
        throw err;
      }
    },
    async () => {
      dispatch(agentId, { name: oldName, nameExplicitlySet: true });
      updateTabTitle(tabId, oldName);
      try {
        await renameSession(agentId, oldName);
      } catch (err) {
        dispatch(agentId, { name: newName, nameExplicitlySet: true });
        updateTabTitle(tabId, newName);
        throw err;
      }
    },
  );
}

describe('PanelLayout agent rename failure revert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reversibleActions.cancelAll();
  });

  afterEach(() => {
    reversibleActions.cancelAll();
  });

  it('reverts optimistic dispatch and tab title when renameSession rejects', async () => {
    const dispatch = vi.fn();
    const updateTabTitle = vi.fn();
    const renameSession = vi
      .fn<(agentId: string, name: string) => Promise<void>>()
      .mockRejectedValue(new Error('rename failed on disk'));

    const result = await runAgentRenameWithUndo({
      agentId: 'agent-1',
      tabId: 'tab-1',
      oldName: 'Old Name',
      newName: 'New Name',
      dispatch,
      updateTabTitle,
      renameSession,
    });

    // renameWithUndo should return false because the action rejected.
    expect(result).toBe(false);

    // The optimistic update happens first, then the revert — both values are
    // written to Redux and to the layout manager so the UI stays consistent
    // with disk.
    expect(dispatch).toHaveBeenNthCalledWith(1, 'agent-1', {
      name: 'New Name',
      nameExplicitlySet: true,
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, 'agent-1', {
      name: 'Old Name',
      nameExplicitlySet: true,
    });

    expect(updateTabTitle).toHaveBeenNthCalledWith(1, 'tab-1', 'New Name');
    expect(updateTabTitle).toHaveBeenNthCalledWith(2, 'tab-1', 'Old Name');

    // The error surfaces as a toast.error; no undo toast should appear.
    expect(toast.error).toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('does not revert when renameSession resolves successfully', async () => {
    const dispatch = vi.fn();
    const updateTabTitle = vi.fn();
    const renameSession = vi
      .fn<(agentId: string, name: string) => Promise<void>>()
      .mockResolvedValue(undefined);

    const result = await runAgentRenameWithUndo({
      agentId: 'agent-2',
      tabId: 'tab-2',
      oldName: 'Old',
      newName: 'New',
      dispatch,
      updateTabTitle,
      renameSession,
    });

    expect(result).toBe(true);

    // Only the optimistic update is applied on success.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('agent-2', {
      name: 'New',
      nameExplicitlySet: true,
    });
    expect(updateTabTitle).toHaveBeenCalledTimes(1);
    expect(updateTabTitle).toHaveBeenCalledWith('tab-2', 'New');

    // Undo toast is shown, not an error.
    expect(toast.warning).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
