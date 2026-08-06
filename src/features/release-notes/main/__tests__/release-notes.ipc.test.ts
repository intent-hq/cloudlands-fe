/**
 * Release-notes IPC tests — the pending-notes slot that closes the startup
 * race: `webContents.send` does not queue for listeners registered later, so
 * the startup notes are also parked and claimed over `release-notes:get-pending`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, data: unknown) => Promise<unknown>>();

vi.mock('electron', () => ({
  app: { getVersion: () => '2.1.0' },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, data: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    },
  },
  BrowserWindow: class {},
}));

const NOTES = {
  version: '2.1.0',
  notes: '## What changed',
  url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.1.0',
};

vi.mock('../release-notes.service', () => ({
  getCurrentReleaseNotes: vi.fn(async () => NOTES),
  checkForReleaseNotesOnStartup: vi.fn(async (show: (notes: typeof NOTES) => void) => {
    show(NOTES);
    return NOTES;
  }),
}));

import { RELEASE_NOTES_CHANNELS } from '../../types';
import {
  __resetPendingReleaseNotesForTests,
  initializeReleaseNotesOnStartup,
  sendShowReleaseNotes,
  setupReleaseNotesIPC,
} from '../release-notes.ipc';

async function invoke(channel: string): Promise<any> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, undefined);
}

function fakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as Electron.BrowserWindow & { webContents: { send: ReturnType<typeof vi.fn> } };
}

describe('release-notes IPC', () => {
  beforeEach(() => {
    handlers.clear();
    __resetPendingReleaseNotesForTests();
    setupReleaseNotesIPC();
  });

  it('parks the startup notes and pushes them to the window', async () => {
    const window = fakeWindow();

    await initializeReleaseNotesOnStartup(window);

    expect(window.webContents.send).toHaveBeenCalledWith(RELEASE_NOTES_CHANNELS.SHOW, {
      notes: NOTES,
    });
    expect(await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING)).toEqual({
      success: true,
      data: NOTES,
    });
  });

  it('clears the pending slot on claim so the modal opens once', async () => {
    await initializeReleaseNotesOnStartup(fakeWindow());

    await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING);

    expect(await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING)).toEqual({
      success: true,
      data: null,
    });
  });

  it('reports nothing pending when no startup showing was due', async () => {
    expect(await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING)).toEqual({
      success: true,
      data: null,
    });
  });

  it('serves the running version notes over release-notes:get', async () => {
    expect(await invoke(RELEASE_NOTES_CHANNELS.GET)).toEqual({ success: true, data: NOTES });
  });

  it('drops the push when the target window is destroyed', () => {
    const send = vi.fn();
    sendShowReleaseNotes(
      { isDestroyed: () => true, webContents: { send } } as unknown as Electron.BrowserWindow,
      { notes: null },
    );

    expect(send).not.toHaveBeenCalled();
  });
});
