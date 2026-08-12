import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createBrowserFocusOwnershipReporter } from '../browser-focus-ownership';

describe('browser focus ownership lifecycle', () => {
  const invoke = vi.fn(async () => ({ success: true }));
  let nextOwner = 0;

  beforeEach(() => {
    invoke.mockClear();
    nextOwner = 0;
  });

  function reporter() {
    return createBrowserFocusOwnershipReporter(invoke, () => `owner-${++nextOwner}`);
  }

  it('releases the browser focus claim on unmount', () => {
    const ownership = reporter();
    ownership.update('workspace:panel-a:browser-a');

    ownership.destroy();

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, { browserFocused: true, focusOwnerId: 'owner-1' }],
      [IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, { browserFocused: false, focusOwnerId: 'owner-1' }],
    ]);
  });

  it('uses distinct ownership when a browser panel identity is replaced', () => {
    const ownership = reporter();
    ownership.update('workspace:panel-a:browser-a');

    ownership.update('workspace:panel-b:browser-b');

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, { browserFocused: true, focusOwnerId: 'owner-1' }],
      [IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, { browserFocused: false, focusOwnerId: 'owner-1' }],
      [IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, { browserFocused: true, focusOwnerId: 'owner-2' }],
    ]);
  });

  it('releases focus on an ordinary transfer to a non-browser panel', () => {
    const ownership = reporter();
    ownership.update('workspace:panel-a:browser-a');

    ownership.update(null);

    expect(invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, {
      browserFocused: false,
      focusOwnerId: 'owner-1',
    });
  });
});
