import { describe, expect, it } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import type { StoreState } from '../../../types';
import { TAB_REMOVAL_ACTIONS } from '../../panel-layout/panel-layout-action-utils';
import { removeScript } from '../../scripts/scripts-slice';
import {
  applyPreset,
  clearPanelLayout,
  closeActiveTab,
  closeFocusedPanelTab,
  closeAllOthersEverywhere,
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closeTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
  createGridLayout,
  focusPanel,
  goBack,
  goForward,
  initializeLayout,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  reconcileStaleAgentTabs,
  resetLayout,
} from '../../panel-layout/panel-layout-slice';
import { fileContentPruneSaga } from './file-content-prune-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function stateForWorkspaces(
  currentTabId: string | null,
  workspaces: Record<string, { openPathsByPanel?: string[][]; contentPaths: string[] }>,
): StoreState {
  const panelLayouts: Record<string, unknown> = {};
  const files: Record<string, unknown> = {};
  for (const [workspaceId, fixture] of Object.entries(workspaces)) {
    if (fixture.openPathsByPanel) {
      panelLayouts[workspaceId] = {
        panels: Object.fromEntries(
          fixture.openPathsByPanel.map((paths, panelIndex) => [
            `panel-${panelIndex}`,
            {
              id: `panel-${panelIndex}`,
              tabs: paths.map((path, tabIndex) => ({
                id: `tab-${panelIndex}-${tabIndex}`,
                type: 'file',
                title: path,
                closable: true,
                filePath: path,
              })),
              activeTabId: null,
            },
          ]),
        ),
      };
    }
    files[workspaceId] = {
      files: {
        ids: fixture.contentPaths,
        byId: Object.fromEntries(
          fixture.contentPaths.map((path) => [path, { absolutePath: path }]),
        ),
      },
    };
  }
  return {
    tabState: { currentTabId },
    panelLayout: { byWorkspaceId: panelLayouts },
    files: { byWorkspaceId: files },
  } as unknown as StoreState;
}

function createHarness(initialState: StoreState) {
  let currentState = initialState;
  const actions: unknown[] = [];
  const channel = stdChannel();
  const dispatch = (action: unknown) => {
    actions.push(action);
    const typed = action as { type?: string; payload?: [string, string] };
    if (typed.type === 'files/removeFileContentEntry' && typed.payload) {
      const [workspaceId, path] = typed.payload;
      const workspaceFiles = currentState.files.byWorkspaceId[workspaceId];
      if (workspaceFiles) {
        currentState = {
          ...currentState,
          files: {
            ...currentState.files,
            byWorkspaceId: {
              ...currentState.files.byWorkspaceId,
              [workspaceId]: {
                ...workspaceFiles,
                files: {
                  ...workspaceFiles.files,
                  ids: workspaceFiles.files.ids.filter((id) => id !== path),
                },
              },
            },
          },
        };
      }
    }
    return action;
  };
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: () => currentState,
    },
    fileContentPruneSaga,
  );
  return {
    actions,
    put: (action: unknown) => channel.put(action),
    putAfterState: (action: unknown, next: StoreState) => {
      currentState = next;
      channel.put(action);
    },
    task,
  };
}

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';
const NOW = 1;
const emptyLayout = {
  root: { type: 'panel' as const, panelId: 'panel' },
  panels: { panel: { id: 'panel', tabs: [], activeTabId: null } },
  focusedPanelId: 'panel',
};

const tabRemovalActionCases = [
  initializeLayout(WS_2, emptyLayout),
  applyPreset(WS_2, 'single', NOW),
  createGridLayout(WS_2, 1, NOW),
  closeTab(WS_2, 'tab', 'panel', NOW),
  closeActiveTab(WS_2, 'panel', NOW),
  closeFocusedPanelTab(WS_2, NOW),
  closeTabsByType(WS_2, 'file', undefined, undefined, NOW),
  closeTabsByAgentId(WS_2, 'agent', NOW),
  moveTabToPanel(WS_2, 'tab', 'from', 'to', 0, NOW),
  moveTabToSplit(WS_2, 'tab', 'from', 'target', 'left', NOW),
  moveTabToSplitLevel(WS_2, 'tab', 'from', [], 'before', 'horizontal', NOW),
  closeOtherTabs(WS_2, 'tab', 'panel', NOW),
  closeTabsToRight(WS_2, 'tab', 'panel', NOW),
  closeAllTabs(WS_2, 'panel', NOW),
  closeAllOthersEverywhere(WS_2, 'tab', 'panel', NOW),
  closePanel(WS_2, 'panel', NOW),
  resetLayout(WS_2),
  goBack(WS_2, NOW),
  goForward(WS_2),
  reconcileStaleAgentTabs(WS_2, [], 'replacement', 'Replacement'),
  removeScript(WS_2, 'script'),
  clearPanelLayout(WS_2),
];

describe('fileContentPruneSaga', () => {
  it('uses the complete established tab-removal action family', () => {
    expect(tabRemovalActionCases.map((action) => action.type)).toEqual(
      TAB_REMOVAL_ACTIONS.map((action) => action.type),
    );
  });

  it.each(tabRemovalActionCases)('prunes after $type', async (action) => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: [] },
        [WS_2]: { openPathsByPanel: [['src/stale.ts']], contentPaths: ['src/stale.ts'] },
      }),
    );
    await settle();
    harness.putAfterState(
      action,
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: [] },
        [WS_2]: {
          openPathsByPanel: action.type === clearPanelLayout.type ? undefined : [[]],
          contentPaths: ['src/stale.ts'],
        },
      }),
    );
    await settle();

    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: [WS_2, 'src/stale.ts'] },
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not perform a startup or retroactive prune', async () => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: ['src/stale.ts'] },
      }),
    );
    await settle();

    expect(harness.actions).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it.each([
    closeTab(WS_1, 'missing-tab', 'panel-0', NOW),
    closePanel(WS_1, 'missing-panel', NOW),
    reconcileStaleAgentTabs(WS_1, ['existing-agent'], 'replacement', 'Replacement'),
  ])('does not prune a stale cache after a no-op $type target', async (action) => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: ['src/stale.ts'] },
      }),
    );
    await settle();
    harness.putAfterState(
      action,
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: ['src/stale.ts'] },
      }),
    );
    await settle();

    expect(harness.actions).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('retains no-op identity after an intervening panel-layout action', async () => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[], []], contentPaths: ['src/stale.ts'] },
      }),
    );
    await settle();
    const focusedState = stateForWorkspaces(WS_1, {
      [WS_1]: { openPathsByPanel: [[], []], contentPaths: ['src/stale.ts'] },
    });
    harness.putAfterState(focusPanel(WS_1, 'panel-1'), focusedState);
    await settle();
    harness.put(closeTab(WS_1, 'missing-tab', 'panel-0', NOW));
    await settle();

    expect(harness.actions).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('ignores unrelated actions', async () => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: ['src/stale.ts'] },
      }),
    );
    await settle();
    harness.put({ type: 'unrelated/action', payload: { wsId: WS_1 } });
    await settle();

    expect(harness.actions).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('removes multiple stale paths once each and keeps a path open in another panel', async () => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_1]: {
          openPathsByPanel: [
            ['src/a.ts', 'src/b.ts'],
            ['src/keep.ts', 'src/keep.ts'],
          ],
          contentPaths: ['src/b.ts', 'src/keep.ts', 'src/a.ts'],
        },
      }),
    );
    await settle();
    harness.putAfterState(
      closeAllTabs(WS_1, 'panel-0', NOW),
      stateForWorkspaces(WS_1, {
        [WS_1]: {
          openPathsByPanel: [[], ['src/keep.ts', 'src/keep.ts']],
          contentPaths: ['src/b.ts', 'src/keep.ts', 'src/a.ts'],
        },
      }),
    );
    await settle();

    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: [WS_1, 'src/a.ts'] },
      { type: 'files/removeFileContentEntry', payload: [WS_1, 'src/b.ts'] },
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('prunes only the inactive workspace named by the action', async () => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: ['src/active-stale.ts'] },
        [WS_2]: {
          openPathsByPanel: [['src/inactive-stale.ts']],
          contentPaths: ['src/inactive-stale.ts'],
        },
      }),
    );
    await settle();
    harness.putAfterState(
      closeTab(WS_2, 'tab-0-0', 'panel-0', NOW),
      stateForWorkspaces(WS_1, {
        [WS_1]: { openPathsByPanel: [[]], contentPaths: ['src/active-stale.ts'] },
        [WS_2]: { openPathsByPanel: [[]], contentPaths: ['src/inactive-stale.ts'] },
      }),
    );
    await settle();

    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: [WS_2, 'src/inactive-stale.ts'] },
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('prunes all cached paths after the workspace layout is cleared', async () => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_2]: {
          openPathsByPanel: [['src/b.ts', 'src/a.ts']],
          contentPaths: ['src/b.ts', 'src/a.ts'],
        },
      }),
    );
    await settle();
    harness.putAfterState(
      clearPanelLayout(WS_2),
      stateForWorkspaces(WS_1, {
        [WS_2]: { contentPaths: ['src/b.ts', 'src/a.ts'] },
      }),
    );
    await settle();

    expect(harness.actions).toEqual([
      { type: 'files/removeFileContentEntry', payload: [WS_2, 'src/a.ts'] },
      { type: 'files/removeFileContentEntry', payload: [WS_2, 'src/b.ts'] },
    ]);
    harness.task.cancel();
    await harness.task.toPromise();
  });

  it('does not prune for a removal action when the layout is missing', async () => {
    const harness = createHarness(
      stateForWorkspaces(WS_1, {
        [WS_2]: { contentPaths: ['src/stale.ts'] },
      }),
    );
    await settle();
    harness.put(closeTab(WS_2, 'missing-tab', 'missing-panel', NOW));
    await settle();

    expect(harness.actions).toEqual([]);
    harness.task.cancel();
    await harness.task.toPromise();
  });
});
