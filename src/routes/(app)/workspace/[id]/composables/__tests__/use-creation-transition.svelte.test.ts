import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { take, type SagaGenerator } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import {
  openWorkspaceTab,
  workspaceTabsHydrated,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import { setPendingCreation } from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceStatus } from '$shared/types';
import { useCreationTransition } from '../use-creation-transition.svelte';

let dispose: () => void;
let cleanup: (() => void) | undefined;
let cancel: () => void;
let tabActions: ReturnType<typeof openWorkspaceTab>[];

beforeEach(() => {
  dispose = store.init();
  tabActions = [];
  cancel = store.runSaga(function* (): SagaGenerator<void> {
    while (true) tabActions.push(yield* take(openWorkspaceTab));
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  cancel();
  dispose();
});

function mount(workspaceId: string, onTransitionDetected?: () => void) {
  let composable!: ReturnType<typeof useCreationTransition>;
  cleanup = $effect.root(() => {
    composable = useCreationTransition({
      workspaceId,
      previousWorkspaceId: workspaceId,
      onTransitionDetected,
    });
  });
  flushSync();
  return composable;
}

describe('useCreationTransition', () => {
  it('never opens the workspace tab itself; openAndShowWorkspace owns that', () => {
    store.dispatch(workspaceTabsHydrated('local'));

    mount('destination');

    expect(tabActions).toEqual([]);
    expect(store.state.tabState.currentTabId).not.toBe('destination');
  });

  it('reports a workspace whose creation is still pending', () => {
    store.dispatch(
      setPendingCreation({
        id: 'pending-ws',
        title: 'Pending ws',
        branch: 'main',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    );
    const onTransitionDetected = vi.fn();

    const transition = mount('pending-ws', onTransitionDetected);

    expect(transition.isInTransition).toBe(true);
    expect(onTransitionDetected).toHaveBeenCalledTimes(1);
  });

  it('is not in transition for a settled workspace', () => {
    const onTransitionDetected = vi.fn();

    const transition = mount('settled-ws', onTransitionDetected);

    expect(transition.isInTransition).toBe(false);
    expect(onTransitionDetected).not.toHaveBeenCalled();
  });
});
