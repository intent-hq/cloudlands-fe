import { describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

import type { StoreState } from '../../../types';
import { cleanupClosedFileContentEntries, fileContentPruneSaga } from './file-content-prune-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state(
  workspaceId: string | null,
  openPaths: string[],
  contentPaths: string[],
): StoreState {
  return {
    workspace: { activeWorkspaceId: workspaceId },
    panelLayout: {
      byWorkspaceId: workspaceId
        ? {
            [workspaceId]: {
              panels: {
                panel: {
                  id: 'panel',
                  tabs: openPaths.map((path, index) => ({
                    id: `tab-${index}`,
                    type: 'file',
                    title: path,
                    closable: true,
                    filePath: path,
                  })),
                  activeTabId: null,
                },
              },
            },
          }
        : {},
    },
    files: {
      byWorkspaceId: workspaceId
        ? {
            [workspaceId]: {
              files: {
                ids: contentPaths,
                byId: Object.fromEntries(
                  contentPaths.map((path) => [path, { absolutePath: path }]),
                ),
              },
            },
          }
        : {},
    },
  } as unknown as StoreState;
}

function createHarness(initialState: StoreState) {
  let currentState = initialState;
  const listeners = new Set<() => void>();
  const actions: unknown[] = [];
  const unsubscribe = vi.fn();
  const reduxStore = {
    getState: () => currentState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  };
  const dispatch = (action: unknown) => {
    actions.push(action);
    const typed = action as { type?: string; payload?: [string, string] };
    if (typed.type === 'files/removeFileContentEntry' && typed.payload) {
      const [workspaceId, path] = typed.payload;
      const files = currentState.files.byWorkspaceId[workspaceId]?.files;
      if (files) {
        currentState = state(
          currentState.workspace.activeWorkspaceId,
          Object.values(currentState.panelLayout.byWorkspaceId[workspaceId]?.panels ?? {})
            .flatMap((panel) => panel.tabs)
            .filter((tab) => tab.type === 'file')
            .map((tab) => tab.filePath),
          files.ids.filter((id) => id !== path),
        );
      }
    }
    for (const listener of [...listeners]) listener();
    return action;
  };
  const task = runSaga(
    {
      context: { reduxStore },
      dispatch,
      getState: () => currentState,
    },
    fileContentPruneSaga,
  );
  return {
    actions,
    notify: () => {
      for (const listener of [...listeners]) listener();
    },
    replaceState: (next: StoreState) => {
      currentState = next;
    },
    task,
    unsubscribe,
  };
}

describe('fileContentPruneSaga', () => {
  it('removes every stale path in sorted selector order', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => state('ws-1', [], ['src/b.ts', 'src/a.ts']) },
      cleanupClosedFileContentEntries,
      { payload: ['src/a.ts', 'src/b.ts'], prevPayload: [] },
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/a.ts'] },
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/b.ts'] },
    ]);
  });

  it('does nothing for empty payloads or invalid active workspaces', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => state('ws-1', [], []) },
      cleanupClosedFileContentEntries,
      { payload: [], prevPayload: null },
    ).toPromise();
    for (const workspaceId of [null, 'new', 'optimistic-1', 'undefined']) {
      await runSaga(
        { dispatch, getState: () => state(workspaceId, [], ['src/a.ts']) },
        cleanupClosedFileContentEntries,
        { payload: ['src/a.ts'], prevPayload: [] },
      ).toPromise();
    }

    expect(dispatch.mock.calls).toEqual([]);
  });

  it('performs the initial retroactive prune without self-trigger duplicates', async () => {
    const harness = createHarness(state('ws-1', [], ['src/b.ts', 'src/a.ts']));
    await settle();

    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/a.ts'] },
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/b.ts'] },
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('deduplicates unchanged selector values but prunes a re-created stale path', async () => {
    const harness = createHarness(state('ws-1', ['src/a.ts'], ['src/a.ts']));
    await settle();
    harness.notify();
    expect(harness.actions).toEqual([]);

    harness.replaceState(state('ws-1', [], ['src/a.ts']));
    harness.notify();
    await settle();
    harness.notify();
    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/a.ts'] },
    ]);

    harness.replaceState(state('ws-1', [], ['src/a.ts']));
    harness.notify();
    await settle();
    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/a.ts'] },
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/a.ts'] },
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('suppresses selector re-entry while pruning multiple stale paths', async () => {
    const harness = createHarness(
      state('ws-1', ['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/b.ts']),
    );
    await settle();
    harness.replaceState(state('ws-1', [], ['src/a.ts', 'src/b.ts']));
    harness.notify();
    await settle();

    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/a.ts'] },
      { type: 'files/removeFileContentEntry', payload: ['ws-1', 'src/b.ts'] },
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('tolerates missing layout/files state and keeps duplicate open paths live', async () => {
    const missing = createHarness(state('ws-1', [], []));
    await settle();
    expect(missing.actions).toEqual([]);
    missing.task.cancel();
    await missing.task.toPromise();

    const duplicate = createHarness(state('ws-1', ['src/a.ts', 'src/a.ts'], ['src/a.ts']));
    await settle();
    expect(duplicate.actions).toEqual([]);
    duplicate.task.cancel();
    await duplicate.task.toPromise();
  });

  it('unsubscribes the selector channel on cancellation and ignores later changes', async () => {
    const harness = createHarness(state('ws-1', ['src/a.ts'], ['src/a.ts']));
    await settle();
    harness.task.cancel();
    await harness.task.toPromise();
    harness.replaceState(state('ws-1', [], ['src/a.ts']));
    harness.notify();
    await settle();

    expect(harness.unsubscribe.mock.calls).toEqual([[]]);
    expect(harness.actions).toEqual([]);
  });
});
