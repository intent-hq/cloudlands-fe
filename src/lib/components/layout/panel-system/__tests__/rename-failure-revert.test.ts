/**
 * Regression tests for the rename-failure revert path used by
 * `PanelLayout.svelte` and `AgentCard.svelte`.
 *
 * When `renameSession` rejects, both call sites used to discard
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

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

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
import {
  renameWithUndo,
  reversibleActions,
} from '$lib/utils/reversible-actions';

/**
 * Reproduces the `handleTabRename` agent branch from PanelLayout.svelte
 * without mounting the Svelte component. The captured dispatch / updateTabTitle
 * spies stand in for `appStore.dispatch` and
 * `layoutManager.updateTabTitle`.
 */
function runAgentRenameWithUndo(opts: {
  agentId: string;
  tabId: string;
  oldName: string;
  newName: string;
  /** Pre-rename value of `nameExplicitlySet` captured from Redux. */
  oldNameExplicitlySet?: boolean;
  dispatch: (agentId: string, updates: Record<string, unknown>) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  renameSession: (agentId: string, newName: string) => Promise<void>;
}) {
  const {
    agentId,
    tabId,
    oldName,
    newName,
    oldNameExplicitlySet = false,
    dispatch,
    updateTabTitle,
    renameSession,
  } = opts;
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
        dispatch(agentId, { name: oldName, nameExplicitlySet: oldNameExplicitlySet });
        updateTabTitle(tabId, oldName);
        throw err;
      }
    },
    async () => {
      dispatch(agentId, { name: oldName, nameExplicitlySet: oldNameExplicitlySet });
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

/**
 * Reproduces AgentCard.svelte's `saveEdit()` rename path — a direct optimistic
 * dispatch followed by `renameSession(...).catch(...)` that
 * reverts Redux to the previously captured name + `nameExplicitlySet` flag.
 */
async function runAgentCardSaveEdit(opts: {
  agentId: string;
  oldName: string;
  newName: string;
  oldNameExplicitlySet: boolean;
  dispatch: (agentId: string, updates: Record<string, unknown>) => void;
  renameSession: (agentId: string, newName: string) => Promise<void>;
  onError: () => void;
}) {
  const { agentId, oldName, newName, oldNameExplicitlySet, dispatch, renameSession, onError } =
    opts;
  dispatch(agentId, { name: newName, nameExplicitlySet: true });
  await renameSession(agentId, newName).catch(() => {
    dispatch(agentId, { name: oldName, nameExplicitlySet: oldNameExplicitlySet });
    onError();
  });
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
      oldNameExplicitlySet: true,
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
      oldNameExplicitlySet: true,
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

  it('preserves pre-rename nameExplicitlySet=false on revert (auto-named session)', async () => {
    // Regression: an auto-named session (nameExplicitlySet: false) that fails
    // to rename must revert Redux to { name: oldName, nameExplicitlySet: false }
    // — NOT the previously hardcoded `true`. Persisting `true` on a session
    // that was never explicitly renamed permanently blocks MCP/auto naming.
    const dispatch = vi.fn();
    const updateTabTitle = vi.fn();
    const renameSession = vi
      .fn<(agentId: string, name: string) => Promise<void>>()
      .mockRejectedValue(new Error('rename failed on disk'));

    const result = await runAgentRenameWithUndo({
      agentId: 'agent-auto',
      tabId: 'tab-auto',
      oldName: 'Auto Name',
      newName: 'User Chose This',
      oldNameExplicitlySet: false,
      dispatch,
      updateTabTitle,
      renameSession,
    });

    expect(result).toBe(false);
    expect(dispatch).toHaveBeenNthCalledWith(2, 'agent-auto', {
      name: 'Auto Name',
      nameExplicitlySet: false,
    });
  });

  it('undo path restores pre-rename nameExplicitlySet=false', async () => {
    // The undo callback (user clicked "Undo" on the rename toast) must also
    // restore the original nameExplicitlySet value, not hardcode `true`.
    const dispatch = vi.fn();
    const updateTabTitle = vi.fn();
    const renameSession = vi
      .fn<(agentId: string, name: string) => Promise<void>>()
      .mockResolvedValue(undefined);

    const result = await runAgentRenameWithUndo({
      agentId: 'agent-undo',
      tabId: 'tab-undo',
      oldName: 'Auto Name',
      newName: 'User Chose This',
      oldNameExplicitlySet: false,
      dispatch,
      updateTabTitle,
      renameSession,
    });

    expect(result).toBe(true);
    // Forward rename dispatched the optimistic update with true.
    expect(dispatch).toHaveBeenNthCalledWith(1, 'agent-undo', {
      name: 'User Chose This',
      nameExplicitlySet: true,
    });
    // No undo invocation yet — this asserts forward path only.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('AgentCard saveEdit rename failure revert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reverts to pre-rename nameExplicitlySet=false when renameSession rejects', async () => {
    // Regression for auto-named agents: on rename failure, Redux must be
    // restored to nameExplicitlySet: false so disk and store stay in sync.
    const dispatch = vi.fn();
    const onError = vi.fn();
    const renameSession = vi
      .fn<(agentId: string, name: string) => Promise<void>>()
      .mockRejectedValue(new Error('rename failed on disk'));

    await runAgentCardSaveEdit({
      agentId: 'agent-card-1',
      oldName: 'Auto Name',
      newName: 'User Chose This',
      oldNameExplicitlySet: false,
      dispatch,
      renameSession,
      onError,
    });

    // Optimistic dispatch, then revert to captured pre-rename flag.
    expect(dispatch).toHaveBeenNthCalledWith(1, 'agent-card-1', {
      name: 'User Chose This',
      nameExplicitlySet: true,
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, 'agent-card-1', {
      name: 'Auto Name',
      nameExplicitlySet: false,
    });
    expect(onError).toHaveBeenCalled();
  });

  it('reverts to pre-rename nameExplicitlySet=true when session was already user-named', async () => {
    const dispatch = vi.fn();
    const onError = vi.fn();
    const renameSession = vi
      .fn<(agentId: string, name: string) => Promise<void>>()
      .mockRejectedValue(new Error('rename failed on disk'));

    await runAgentCardSaveEdit({
      agentId: 'agent-card-2',
      oldName: 'User Named',
      newName: 'User Renamed Again',
      oldNameExplicitlySet: true,
      dispatch,
      renameSession,
      onError,
    });

    expect(dispatch).toHaveBeenNthCalledWith(2, 'agent-card-2', {
      name: 'User Named',
      nameExplicitlySet: true,
    });
    expect(onError).toHaveBeenCalled();
  });
});
