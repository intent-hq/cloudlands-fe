import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  fetchEditorsFailure,
  fetchEditorsSuccess,
  setEditorOrder,
  setHiddenEditorIds,
  setLoading,
  type InstalledEditor,
} from '../../../../../src/store/renderer/slices/external-editors/external-editors-slice';
import {
  openTab,
  setActiveTab,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import type { PanelState } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-types';
import { setMultiSelectSidebarSelectedTabs } from '../../../../../src/store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  workspaceMounted,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { store } from '../index';
import {
  selectInstalledEditors,
  selectInstalledEditorsLoading,
  selectLastFetched,
} from '../external-editors/external-editors-selectors';
import { selectPanels } from '../panel-layout/panel-layout-selectors';
import { selectMultiSelectSidebarSelectedTabIds } from '../sidebar-nav/sidebar-nav-selectors';
import { selectIsWorkspaceHydrated } from './workspace-lifecycle-selectors';

const workspaceId = 'selector-workspace';
const otherWorkspaceId = 'other-selector-workspace';
const stops: Array<() => void> = [];
const runtimeErrors: unknown[] = [];
let dispose: (() => void) | undefined;
const recordError = (error: unknown) => {
  runtimeErrors.push(error);
};

beforeEach(() => {
  runtimeErrors.length = 0;
  dispose = store.init();
  store.traceStreams.runtimeError.onValue(recordError);
});

afterEach(() => {
  const failures: unknown[] = [];
  for (const cleanup of [
    ...stops.splice(0).reverse(),
    () => {
      dispose?.();
      dispose = undefined;
    },
    () => store.traceStreams.runtimeError.offValue(recordError),
    () => expect(runtimeErrors).toEqual([]),
  ]) {
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Selector Store cleanup failed');
});

function editor(id: string, installed = true): InstalledEditor {
  return {
    id,
    name: id,
    shortLabel: id,
    appName: id,
    category: 'ide',
    handlerType: 'generic',
    priority: 0,
    installed,
  };
}

function openNote(wsId: string, noteId: string, tabId: string) {
  store.dispatch(
    openTab(
      wsId,
      { type: 'note', title: noteId, noteId, workspaceId: wsId, closable: true },
      undefined,
      tabId,
      false,
      1,
    ),
  );
}

type ReadResult = {
  editors: InstalledEditor[];
  loading: boolean;
  lastFetched: number;
  panels: Record<string, PanelState>;
  selectedTabIds: string[];
  hydrated: boolean;
};

function readEffects(wsId: string): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    stops.push(
      store.runSaga(function* readSelectorPorts() {
        try {
          resolve({
            editors: yield* selectInstalledEditors.effect(),
            loading: yield* selectInstalledEditorsLoading.effect(),
            lastFetched: yield* selectLastFetched.effect(),
            panels: yield* selectPanels.effect(wsId),
            selectedTabIds: yield* selectMultiSelectSidebarSelectedTabIds.effect(wsId),
            hydrated: yield* selectIsWorkspaceHydrated.effect(wsId),
          });
        } catch (error) {
          reject(error);
        }
      }),
    );
  });
}

describe('lifecycle IPC selector prerequisites on the configured React Store', () => {
  it('reads canonical defaults through real saga effects without creating workspace records', async () => {
    const result = await readEffects(workspaceId);
    expect(result.editors).toEqual([]);
    expect(result.loading).toBe(false);
    expect(result.lastFetched).toBe(0);
    expect(result.panels).toEqual({ default: { id: 'default', tabs: [], activeTabId: null } });
    expect(result.selectedTabIds).toEqual(['overview']);
    expect(result.hydrated).toBe(false);
    expect(result.panels).toBe(selectPanels.select(store.state, workspaceId));
    expect(store.state.panelLayout.byWorkspaceId[workspaceId]).toBeUndefined();
    expect(
      store.state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId],
    ).toBeUndefined();
    expect(store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[workspaceId]).toBeUndefined();
  });

  it('orders stored editors, skips unknown IDs, appends the remainder, and keeps entity identity', () => {
    store.dispatch(fetchEditorsSuccess([editor('alpha'), editor('beta'), editor('gamma')], 100));
    store.dispatch(setEditorOrder(['gamma', 'missing', 'gamma']));
    const ordered = selectInstalledEditors.select(store.state);
    expect(ordered.map(({ id }) => id)).toEqual(['gamma', 'alpha', 'beta']);
    expect(ordered[0]).toBe(getItem(store.state.externalEditors.editors, 'gamma'));
    expect(ordered[1]).toBe(getItem(store.state.externalEditors.editors, 'alpha'));
    expect(ordered[2]).toBe(getItem(store.state.externalEditors.editors, 'beta'));
    // The canonical reducer normalizes duplicate IDs; the projection does not own normalization.
    expect(store.state.externalEditors.editorOrder).toEqual(['gamma', 'missing']);
    store.dispatch(setMultiSelectSidebarSelectedTabs(otherWorkspaceId, []));
    const afterUnrelatedAction = selectInstalledEditors.select(store.state);
    expect(afterUnrelatedAction[0]).toBe(ordered[0]);
    expect(afterUnrelatedAction[1]).toBe(ordered[1]);
    expect(afterUnrelatedAction[2]).toBe(ordered[2]);
  });

  it('uses collection order for an empty preference and leaves visibility filtering to its owner', () => {
    store.dispatch(
      fetchEditorsSuccess([editor('alpha'), editor('beta', false), editor('gamma')], 10),
    );
    store.dispatch(setEditorOrder([]));
    store.dispatch(setHiddenEditorIds(['alpha']));
    const all = selectInstalledEditors.select(store.state);
    expect(all.map(({ id }) => id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(all[0]).toBe(getItem(store.state.externalEditors.editors, 'alpha'));
    expect(all[1].installed).toBe(false);
    store.dispatch(fetchEditorsSuccess([editor('gamma'), editor('delta')], 20));
    expect(selectInstalledEditors.select(store.state).map(({ id }) => id)).toEqual([
      'gamma',
      'delta',
    ]);
    expect(selectLastFetched.select(store.state)).toBe(20);
  });

  it('observes fetch success and failure loading transitions without losing the last result', async () => {
    store.dispatch(setLoading(true));
    expect(selectInstalledEditorsLoading.select(store.state)).toBe(true);
    store.dispatch(fetchEditorsSuccess([editor('alpha')], 55));
    expect(selectInstalledEditorsLoading.select(store.state)).toBe(false);
    expect(selectLastFetched.select(store.state)).toBe(55);
    const stored = getItem(store.state.externalEditors.editors, 'alpha');
    store.dispatch(setLoading(true));
    store.dispatch(fetchEditorsFailure('Detection failed'));
    const result = await readEffects(workspaceId);
    expect(result.loading).toBe(false);
    expect(result.lastFetched).toBe(55);
    expect(result.editors.map(({ id }) => id)).toEqual(['alpha']);
    expect(result.editors[0]).toBe(stored);
  });

  it('retains the canonical missing-panel fallback while another workspace opens a tab', () => {
    const missing = selectPanels.select(store.state, workspaceId);
    expect(missing).toEqual({ default: { id: 'default', tabs: [], activeTabId: null } });
    expect(selectPanels.select(store.state, otherWorkspaceId)).toBe(missing);
    openNote(otherWorkspaceId, 'other-note', 'other-tab');
    expect(selectPanels.select(store.state, workspaceId)).toBe(missing);
    expect(selectPanels.select(store.state, otherWorkspaceId).default.activeTabId).toBe(
      'other-tab',
    );
    expect(store.state.panelLayout.byWorkspaceId[workspaceId]).toBeUndefined();
  });

  it('exposes real panel mutations and active-tab changes without copying stored panels', async () => {
    openNote(workspaceId, 'first-note', 'first-tab');
    const first = selectPanels.select(store.state, workspaceId);
    expect(first.default.activeTabId).toBe('first-tab');
    expect(first).toBe(store.state.panelLayout.byWorkspaceId[workspaceId].panels);
    openNote(workspaceId, 'second-note', 'second-tab');
    const second = selectPanels.select(store.state, workspaceId);
    expect(second).not.toBe(first);
    expect(second.default.tabs.map(({ id }) => id)).toEqual(['first-tab', 'second-tab']);
    expect(second.default.activeTabId).toBe('second-tab');
    store.dispatch(setActiveTab(workspaceId, 'first-tab', undefined, 2));
    const result = await readEffects(workspaceId);
    expect(result.panels.default.activeTabId).toBe('first-tab');
    expect(result.panels).toBe(store.state.panelLayout.byWorkspaceId[workspaceId].panels);
    store.dispatch(setLoading(true));
    expect(selectPanels.select(store.state, workspaceId)).toBe(result.panels);
  });

  it('keeps explicit empty sidebar selections distinct from the missing-workspace default', async () => {
    expect(selectMultiSelectSidebarSelectedTabIds.select(store.state, workspaceId)).toEqual([
      'overview',
    ]);
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, []));
    const empty = selectMultiSelectSidebarSelectedTabIds.select(store.state, workspaceId);
    expect(empty).toEqual([]);
    expect(empty).toBe(store.state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId]);
    expect(selectMultiSelectSidebarSelectedTabIds.select(store.state, otherWorkspaceId)).toEqual([
      'overview',
    ]);
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, ['terminal', 'overview']));
    const selected = selectMultiSelectSidebarSelectedTabIds.select(store.state, workspaceId);
    expect(selected).toEqual(['terminal', 'overview']);
    expect(selected).toBe(
      store.state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId],
    );
    store.dispatch(setMultiSelectSidebarSelectedTabs(otherWorkspaceId, []));
    expect(selectMultiSelectSidebarSelectedTabIds.select(store.state, workspaceId)).toBe(selected);
    expect((await readEffects(workspaceId)).selectedTabIds).toBe(selected);
  });

  it('distinguishes opened from hydrated and live phases through canonical lifecycle actions', async () => {
    // These exercise the reducer's selector contract, not receiver scheduling or completed I/O.
    expect(selectIsWorkspaceHydrated.select(store.state, workspaceId)).toBe(false);
    store.dispatch(workspaceOpenSucceeded(workspaceId));
    expect(selectIsWorkspaceHydrated.select(store.state, workspaceId)).toBe(false);
    expect((await readEffects(workspaceId)).hydrated).toBe(false);
    store.dispatch(workspaceMounted(workspaceId));
    expect(selectIsWorkspaceHydrated.select(store.state, workspaceId)).toBe(true);
    expect((await readEffects(workspaceId)).hydrated).toBe(true);
    store.dispatch(workspaceOpenFailed(workspaceId));
    expect(selectIsWorkspaceHydrated.select(store.state, workspaceId)).toBe(false);
    store.dispatch(workspaceMounted(workspaceId));
    expect(selectIsWorkspaceHydrated.select(store.state, workspaceId)).toBe(true);
    expect(selectIsWorkspaceHydrated.select(store.state, otherWorkspaceId)).toBe(false);
    store.dispatch(workspaceOpenSucceeded(workspaceId));
    expect(selectIsWorkspaceHydrated.select(store.state, workspaceId)).toBe(true);
    store.dispatch(workspaceUnmounted(workspaceId));
    expect(selectIsWorkspaceHydrated.select(store.state, workspaceId)).toBe(false);
    expect((await readEffects(workspaceId)).hydrated).toBe(false);
  });

  it('reads all populated selector ports through the installed Store middleware', async () => {
    store.dispatch(fetchEditorsSuccess([editor('alpha'), editor('beta')], 91));
    store.dispatch(setEditorOrder(['beta']));
    store.dispatch(setLoading(true));
    openNote(workspaceId, 'stored-note', 'stored-tab');
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, ['terminal']));
    store.dispatch(workspaceMounted(workspaceId));
    const result = await readEffects(workspaceId);
    expect(result.editors.map(({ id }) => id)).toEqual(['beta', 'alpha']);
    expect(result.editors[0]).toBe(getItem(store.state.externalEditors.editors, 'beta'));
    expect(result.loading).toBe(true);
    expect(result.lastFetched).toBe(91);
    expect(result.panels.default.activeTabId).toBe('stored-tab');
    expect(result.panels).toBe(selectPanels.select(store.state, workspaceId));
    expect(result.selectedTabIds).toEqual(['terminal']);
    expect(result.selectedTabIds).toBe(
      selectMultiSelectSidebarSelectedTabIds.select(store.state, workspaceId),
    );
    expect(result.hydrated).toBe(true);
    expect(result.hydrated).toBe(selectIsWorkspaceHydrated.select(store.state, workspaceId));
  });
});
