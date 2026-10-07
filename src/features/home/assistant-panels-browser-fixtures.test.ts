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
