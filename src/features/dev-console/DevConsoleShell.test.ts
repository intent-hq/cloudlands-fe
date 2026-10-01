import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import Shell from './DevConsoleShell.svelte';
import { DevConsoleCaptureService } from './main/dev-console-capture';
const original = window.electronAPI;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.electronAPI = original;
});
it('boots from the native console bridge alone and releases listeners on unmount', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const capture = new DevConsoleCaptureService();
  const snapshot = capture.openSession('fixture-a');
  const invoke = vi.fn(async (channel: string) =>
    channel === 'dev-console:connect'
      ? { backendId: 'fixture-a', sessionId: snapshot.sessionId }
      : capture.getUpdate('fixture-a', snapshot.sessionId, -1),
  );
  const offById = vi.fn();
  window.electronAPI = { invoke, on: (channel: string) => channel, offById } as any;
  const view = render(Shell);
  await waitFor(() =>
    expect(view.container.querySelector('[data-dev-console-ready="true"]')).not.toBeNull(),
  );
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
    'dev-console:connect',
    'dev-console:read',
  ]);
  view.unmount();
  expect(offById).toHaveBeenCalledWith('dev-console:changed', 'dev-console:changed');
  expect(offById).toHaveBeenCalledWith('app:reload-request', 'app:reload-request');
});
