import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { sidebarNavSaga } from './sidebar-nav-saga';
import {
  selectChiefActiveAgentId,
  selectMultiSelectSidebarSelectedTabIds,
  selectPinnedWorkspaceIds,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
} from '../sidebar-nav-selectors';
import {
  CHIEF_ACTIVE_AGENT_ID_KEY,
  MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX,
  PINNED_WORKSPACES_KEY,
  setChiefActiveAgentId,
  setMultiSelectSidebarSelectedTabs,
  setWorkspaceNoteOrder,
  togglePinWorkspace,
  toggleWorkspaceCollapsedNote,
  WORKSPACE_COLLAPSED_NOTES_PREFIX,
  WORKSPACE_NOTE_ORDER_PREFIX,
} from '../../../../../../src/store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { connectionsListReceived } from '../../../../../../src/store/renderer/slices/connections/connections-slice';
import { workspaceMounted } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

vi.mock('../../../../../../src/store/renderer/store', () => {
  throw new Error('React sidebar lifecycle imported the Svelte Store');
});

let dispose: () => void;
let stop: (() => void) | undefined;
const ws = 'sidebar-workspace';
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
    storage.set(key, value);
  });
  vi.mocked(localStorage.removeItem).mockImplementation((key) => {
    storage.delete(key);
  });
  vi.mocked(localStorage.clear).mockImplementation(() => storage.clear());
  dispose = store.init();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  dispose();
});

it('rehydrates workspace sidebar choices after the root is restarted', () => {
  stop = store.runSaga(sidebarNavSaga);
  store.dispatch(togglePinWorkspace(ws));
  store.dispatch(setChiefActiveAgentId('chief-agent'));
  store.dispatch(setMultiSelectSidebarSelectedTabs(ws, ['notes', 'agents']));
  store.dispatch(setWorkspaceNoteOrder(ws, ['second', 'first']));
  store.dispatch(toggleWorkspaceCollapsedNote(ws, 'second'));
  expect(JSON.parse(localStorage.getItem(PINNED_WORKSPACES_KEY)!)).toEqual([ws]);
  expect(JSON.parse(localStorage.getItem(CHIEF_ACTIVE_AGENT_ID_KEY)!)).toBe('chief-agent');
  expect(
    JSON.parse(localStorage.getItem(`${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}${ws}`)!),
  ).toEqual(['notes', 'agents']);
  expect(JSON.parse(localStorage.getItem(`${WORKSPACE_NOTE_ORDER_PREFIX}${ws}`)!)).toEqual([
    'second',
    'first',
  ]);
  expect(JSON.parse(localStorage.getItem(`${WORKSPACE_COLLAPSED_NOTES_PREFIX}${ws}`)!)).toEqual([
    'second',
  ]);

  stop();
  dispose();
  dispose = store.init();
  stop = store.runSaga(sidebarNavSaga);
  store.dispatch(workspaceMounted(ws));
  expect(selectPinnedWorkspaceIds.select(store.state)).toEqual([ws]);
  expect(selectChiefActiveAgentId.select(store.state)).toBe('chief-agent');
  expect(selectMultiSelectSidebarSelectedTabIds.select(store.state, ws)).toEqual([
    'notes',
    'agents',
  ]);
  expect(selectWorkspaceNoteOrder.select(store.state, ws)).toEqual(['second', 'first']);
  expect(selectWorkspaceCollapsedNoteIds.select(store.state, ws)).toEqual(['second']);
});

it('uses the window backend namespace and stops persisting after cancellation', () => {
  localStorage.setItem(PINNED_WORKSPACES_KEY, JSON.stringify(['local-workspace']));
  localStorage.setItem(
    `backend:remote:${PINNED_WORKSPACES_KEY}`,
    JSON.stringify(['remote-workspace']),
  );
  stop = store.runSaga(sidebarNavSaga);
  expect(selectPinnedWorkspaceIds.select(store.state)).toEqual(['local-workspace']);
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
  );
  expect(selectPinnedWorkspaceIds.select(store.state)).toEqual(['remote-workspace']);
  store.dispatch(togglePinWorkspace(ws));
  expect(JSON.parse(localStorage.getItem(`backend:remote:${PINNED_WORKSPACES_KEY}`)!)).toEqual([
    'remote-workspace',
    ws,
  ]);
  expect(JSON.parse(localStorage.getItem(PINNED_WORKSPACES_KEY)!)).toEqual(['local-workspace']);
  stop();
  const before = localStorage.getItem(`backend:remote:${PINNED_WORKSPACES_KEY}`);
  store.dispatch(togglePinWorkspace('after-stop'));
  expect(localStorage.getItem(`backend:remote:${PINNED_WORKSPACES_KEY}`)).toBe(before);
});
