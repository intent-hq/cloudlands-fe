import { afterEach, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { readNoteRequested } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { setupAssistantPanelsFixture } from './assistant-panels-browser-fixtures';
import { startHomePreview } from './home-preview-lifecycle';

vi.mock('$features/layout/tab-types/register-all', () => ({ registerAllTabTypes: vi.fn() }));

const stops: Array<() => void> = [];

afterEach(() => {
  while (stops.length) stops.pop()?.();
  vi.restoreAllMocks();
});

it.each([false, true])(
  'reads fixture notes across remounts with an existing root: %s',
  async (existingRoot) => {
    if (existingRoot) stops.push(startRootStoreLifecycle(store, { startSagas: () => [] }));
    const previousBridge = window.electronAPI;

    for (const content of ['First preview content', 'Replacement preview content']) {
      const stop = startHomePreview(() => [setupAssistantPanelsFixture(content)]);
      stops.push(stop);
      const invoke = vi.spyOn(window.electronAPI, 'invoke');
      const read = store.dispatch(readNoteRequested(CHIEF_WORKSPACE_ID, 'plan'));

      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.BACKEND.REQUEST, {
          method: 'note.get',
          params: { workspaceId: CHIEF_WORKSPACE_ID, noteId: 'plan' },
        }),
      );
      await expect(read).resolves.toMatchObject({ content, workspaceId: CHIEF_WORKSPACE_ID });
      expect(selectNoteById.select(store.state, CHIEF_WORKSPACE_ID, 'plan')?.content).toBe(content);

      await expect(
        store.dispatch(readNoteRequested('example-workspace', 'plan')),
      ).resolves.toMatchObject({
        workspaceId: 'example-workspace',
        title: 'Workspace plan',
      });
      await expect(
        store.dispatch(readNoteRequested(CHIEF_WORKSPACE_ID, 'missing')),
      ).resolves.toBeNull();
      expect(invoke).toHaveBeenCalledTimes(3);
      stops.pop()?.();
      expect(window.electronAPI).toBe(previousBridge);
    }
  },
);

it('cancels pending reads and removes the reader before restoring the bridge', async () => {
  stops.push(startRootStoreLifecycle(store, { startSagas: () => [] }));
  const previousBridge = window.electronAPI;
  const previousInvoke = vi.spyOn(previousBridge, 'invoke');
  const stop = startHomePreview(() => [setupAssistantPanelsFixture('Late preview content')]);
  stops.push(stop);
  const originalInvoke = window.electronAPI.invoke.bind(window.electronAPI);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = vi.spyOn(window.electronAPI, 'invoke').mockImplementation(async (...args) => {
    const response = await originalInvoke(...args);
    await held;
    return response;
  });
  const request = readNoteRequested(CHIEF_WORKSPACE_ID, 'plan');
  store.dispatch(request);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

  stops.pop()?.();
  expect(window.electronAPI).toBe(previousBridge);
  const afterStop = selectNoteById.select(store.state, CHIEF_WORKSPACE_ID, 'plan');
  release();
  await held;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(selectNoteById.select(store.state, CHIEF_WORKSPACE_ID, 'plan')).toBe(afterStop);

  store.dispatch(readNoteRequested(CHIEF_WORKSPACE_ID, 'second'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(previousInvoke).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledOnce();
});

it('shares the real root note owner and ignores repeated old disposal after remount', async () => {
  const { workspaceNotesSaga } =
    await import('$store/renderer/slices/workspace-notes/sagas/workspace-notes-saga');
  stops.push(
    startRootStoreLifecycle(store, {
      startSagas: () => [store.runSaga(workspaceNotesSaga)],
    }),
  );
  const previousBridge = window.electronAPI;
  const old = setupAssistantPanelsFixture('Old fixture');
  stops.push(old);
  const firstInvoke = vi.spyOn(window.electronAPI, 'invoke');
  await expect(
    store.dispatch(readNoteRequested(CHIEF_WORKSPACE_ID, 'plan')),
  ).resolves.toMatchObject({ content: 'Old fixture' });
  expect(firstInvoke).toHaveBeenCalledTimes(1);
  old();
  expect(window.electronAPI).toBe(previousBridge);
  const fresh = setupAssistantPanelsFixture('New fixture');
  stops.push(fresh);
  const freshBridge = window.electronAPI;
  old();
  expect(window.electronAPI).toBe(freshBridge);
  const invoke = vi.spyOn(freshBridge, 'invoke');
  await expect(
    store.dispatch(readNoteRequested(CHIEF_WORKSPACE_ID, 'plan')),
  ).resolves.toMatchObject({ content: 'New fixture' });
  expect(invoke).toHaveBeenCalledTimes(1);
  fresh();
  window.electronAPI = freshBridge;
  await expect(
    store.dispatch(readNoteRequested(CHIEF_WORKSPACE_ID, 'second')),
  ).resolves.toMatchObject({ title: 'Second plan' });
  expect(invoke).toHaveBeenCalledTimes(2);
  window.electronAPI = previousBridge;
});

it('leaves a newer fixture bridge and request log owned after old cleanup', () => {
  stops.push(startRootStoreLifecycle(store, { startSagas: () => [] }));
  const scope = window as typeof window & { assistantNoteRequests?: unknown[] };
  const old = setupAssistantPanelsFixture('Old request owner');
  stops.push(old);
  const current = setupAssistantPanelsFixture('Current request owner');
  stops.push(current);
  const bridge = window.electronAPI,
    requests = scope.assistantNoteRequests;
  old();
  old();
  expect(window.electronAPI).toBe(bridge);
  expect(scope.assistantNoteRequests).toBe(requests);
});

it('opens metadata for a note already paged elsewhere without an unleased full read', async () => {
  const { pagePanelOpened, pagePanelClosed } =
    await import('$store/renderer/slices/note-pages/note-pages-slice');
  const { initializeLayout } =
    await import('$store/renderer/slices/panel-layout/panel-layout-slice');
  const { assistantPanelLayoutId } = await import('$shared/assistant-panel-layout');
  const { showAssistantContent } = await import('./assistant-panels');
  const { selectPanelLayoutWorkspace } =
    await import('$store/renderer/slices/panel-layout/panel-layout-selectors');
  const stop = startHomePreview(() => [setupAssistantPanelsFixture('Retained note source')]);
  stops.push(stop);
  await expect(
    store.dispatch(readNoteRequested('example-workspace', 'plan')),
  ).resolves.toMatchObject({ id: 'plan', workspaceId: 'example-workspace' });
  const layoutId = assistantPanelLayoutId(null);
  store.dispatch(
    initializeLayout(layoutId, {
      root: { type: 'panel', panelId: 'assistant-content' },
      panels: { 'assistant-content': { id: 'assistant-content', tabs: [], activeTabId: null } },
      focusedPanelId: null,
    }),
  );
  store.dispatch(pagePanelOpened('example-workspace', 'plan', 'retained-reader'));
  try {
    const invoke = vi.spyOn(window.electronAPI, 'invoke');
    await showAssistantContent('intent://local/example-workspace/note/plan');
    const tabs = selectPanelLayoutWorkspace.select(store.state, layoutId).panels[
      'assistant-content'
    ].tabs;
    expect(
      tabs.some(
        (tab) =>
          tab.type === 'note' && tab.noteId === 'plan' && tab.workspaceId === 'example-workspace',
      ),
    ).toBe(true);
    expect(
      invoke.mock.calls.filter(
        ([, request]) => (request as { method?: string })?.method === 'note.get',
      ),
    ).toHaveLength(0);
    const { beginFullNoteEdit } = await import('$features/notes/notes-read-service');
    const { selectNotePageSession } =
      await import('$store/renderer/slices/note-pages/note-pages-selectors');
    const priorReader = selectNotePageSession.select(store.state, 'example-workspace', 'plan')
      ?.panels['retained-reader'];
    expect(priorReader).toBeDefined();
    const edit = beginFullNoteEdit('example-workspace', 'plan');
    try {
      await expect(edit.load()).resolves.toBe(true);
      expect(selectNoteById.select(store.state, 'example-workspace', 'plan')?.content).toBe(
        '# Workspace plan\n\nA separate plan from another workspace.',
      );
      expect(
        invoke.mock.calls.filter(
          ([, request]) => (request as { method?: string })?.method === 'note.get',
        ),
      ).toEqual([
        [
          IPC_CHANNELS.BACKEND.REQUEST,
          { method: 'note.get', params: { workspaceId: 'example-workspace', noteId: 'plan' } },
        ],
      ]);
      expect(
        selectNotePageSession.select(store.state, 'example-workspace', 'plan')?.panels[
          'retained-reader'
        ],
      ).toBe(priorReader);
    } finally {
      edit.release();
    }
    expect(
      selectNotePageSession.select(store.state, 'example-workspace', 'plan')?.panels[
        'retained-reader'
      ],
    ).toBe(priorReader);
  } finally {
    store.dispatch(pagePanelClosed('example-workspace', 'plan', 'retained-reader'));
  }
});

it('does not reopen retained metadata removed during a workspace lookup', async () => {
  const { pagePanelOpened, pagePanelClosed } =
    await import('$store/renderer/slices/note-pages/note-pages-slice');
  const { clearWorkspaceNotesForWorkspaces } =
    await import('$store/renderer/slices/workspace-notes/workspace-notes-slice');
  const { initializeLayout } =
    await import('$store/renderer/slices/panel-layout/panel-layout-slice');
  const { assistantPanelLayoutId } = await import('$shared/assistant-panel-layout');
  const { showAssistantContent } = await import('./assistant-panels');
  const { selectPanelLayoutWorkspace } =
    await import('$store/renderer/slices/panel-layout/panel-layout-selectors');
  stops.push(startHomePreview(() => [setupAssistantPanelsFixture()]));
  await expect(
    store.dispatch(readNoteRequested('example-workspace', 'plan')),
  ).resolves.toMatchObject({ id: 'plan' });
  const layoutId = assistantPanelLayoutId(null);
  store.dispatch(
    initializeLayout(layoutId, {
      root: { type: 'panel', panelId: 'assistant-content' },
      panels: { 'assistant-content': { id: 'assistant-content', tabs: [], activeTabId: null } },
      focusedPanelId: null,
    }),
  );
  store.dispatch(pagePanelOpened('example-workspace', 'plan', 'retained-reader'));
  const originalInvoke = window.electronAPI.invoke.bind(window.electronAPI);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = vi.spyOn(window.electronAPI, 'invoke').mockImplementation(async (...args) => {
    const result = await originalInvoke(...args);
    if ((args[1] as { method?: string })?.method === 'workspace.get') await held;
    return result;
  });
  const opening = showAssistantContent('intent://local/example-workspace/note/plan');
  try {
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.some(
          ([, request]) => (request as { method?: string })?.method === 'workspace.get',
        ),
      ).toBe(true),
    );
    store.dispatch(clearWorkspaceNotesForWorkspaces(['example-workspace']));
    expect(selectNoteById.select(store.state, 'example-workspace', 'plan')).toBeUndefined();
    release();
    await opening;
    expect(
      selectPanelLayoutWorkspace.select(store.state, layoutId).panels['assistant-content'].tabs,
    ).toHaveLength(0);
    expect(
      invoke.mock.calls.filter(
        ([, request]) => (request as { method?: string })?.method === 'note.get',
      ),
    ).toHaveLength(0);
  } finally {
    release();
    await opening;
    store.dispatch(pagePanelClosed('example-workspace', 'plan', 'retained-reader'));
  }
});

it('models strict note updates with matching identity, revision and saved echoes', async () => {
  const { appClient } = await import('$lib/client');
  stops.push(startHomePreview(() => [setupAssistantPanelsFixture('Original source')]));
  const invoke = vi.spyOn(window.electronAPI, 'invoke');
  await expect(
    appClient.notes.update('plan', 'Saved source', 1, CHIEF_WORKSPACE_ID),
  ).resolves.toMatchObject({
    id: 'plan',
    workspaceId: CHIEF_WORKSPACE_ID,
    content: 'Saved source',
    rev: 2,
  });
  expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
    method: 'note.update',
    params: {
      workspaceId: CHIEF_WORKSPACE_ID,
      noteId: 'plan',
      content: 'Saved source',
      expectedVersion: 1,
    },
  });
  await expect(
    appClient.notes.update('plan', 'Stale source', 1, CHIEF_WORKSPACE_ID),
  ).rejects.toThrow('Conflict');
  await expect(
    appClient.notes.update('missing', 'Wrong note', 1, CHIEF_WORKSPACE_ID),
  ).rejects.toThrow('Note not found');
  await expect(
    appClient.notes.update('plan', 'Wrong workspace', 1, 'unknown-workspace'),
  ).rejects.toThrow('Note not found');
  await expect(appClient.notes.get('plan', CHIEF_WORKSPACE_ID)).resolves.toMatchObject({
    content: 'Saved source',
    rev: 2,
  });
});

it('rejects a held strict save without mutation and rechecks revision after waiting', async () => {
  const { appClient } = await import('$lib/client');
  stops.push(startHomePreview(() => [setupAssistantPanelsFixture('Original source')]));
  const control = (
    window as typeof window & {
      assistantNoteSaveControl: import('./assistant-panels-browser-fixtures').AssistantNoteSaveControl;
    }
  ).assistantNoteSaveControl;
  control.holdNext();
  const first = appClient.notes.update('plan', 'Failed draft', 1, CHIEF_WORKSPACE_ID);
  const failed = expect(first).rejects.toThrow('Controlled refusal');
  await vi.waitFor(() => expect(control.pending).toBe(true));
  control.settle('Controlled refusal');
  await failed;
  await expect(appClient.notes.get('plan', CHIEF_WORKSPACE_ID)).resolves.toMatchObject({
    content: 'Original source',
    rev: 1,
  });
  control.holdNext();
  const delayed = appClient.notes.update('plan', 'Superseded draft', 1, CHIEF_WORKSPACE_ID);
  const conflict = expect(delayed).rejects.toThrow('Conflict');
  await vi.waitFor(() => expect(control.pending).toBe(true));
  await expect(
    appClient.notes.update('plan', 'Current source', 1, CHIEF_WORKSPACE_ID),
  ).resolves.toMatchObject({ content: 'Current source', rev: 2 });
  control.settle();
  await conflict;
  await expect(appClient.notes.get('plan', CHIEF_WORKSPACE_ID)).resolves.toMatchObject({
    content: 'Current source',
    rev: 2,
  });
});
