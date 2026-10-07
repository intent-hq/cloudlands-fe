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

it('preserves a replacement bridge when its preview stops', () => {
  stops.push(startRootStoreLifecycle(store, { startSagas: () => [] }));
  const previousBridge = window.electronAPI;
  const stop = startHomePreview(() => [setupAssistantPanelsFixture()]);
  stops.push(stop);
  const replacementBridge = { ...previousBridge };
  window.electronAPI = replacementBridge;
  try {
    stops.pop()?.();
    expect(window.electronAPI).toBe(replacementBridge);
  } finally {
    window.electronAPI = previousBridge;
  }
});
