/**
 * Release-notes IPC tests — startup broadcast to every window, the
 * pending-notes slot that closes the startup race (`webContents.send` does not
 * queue for listeners registered later, so the notes are also parked and read
 * over `release-notes:get-pending`), and the dismiss → close fan-out.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, data: unknown) => Promise<unknown>>();
let allWindows: unknown[] = [];

vi.mock('electron', () => ({
  app: { getVersion: () => '2.1.0' },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, data: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    },
  },
  BrowserWindow: { getAllWindows: () => allWindows },
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

async function invoke(channel: string, sender: unknown = {}): Promise<any> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({ sender }, undefined);
}

function fakeWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  } as unknown as Electron.BrowserWindow & { webContents: { send: ReturnType<typeof vi.fn> } };
}

describe('release-notes IPC', () => {
  beforeEach(() => {
    handlers.clear();
    allWindows = [];
    __resetPendingReleaseNotesForTests();
    setupReleaseNotesIPC();
  });

  it('parks the startup notes and pushes them to every open window', async () => {
    const windows = [fakeWindow(), fakeWindow(), fakeWindow()];
    allWindows = windows;

    await initializeReleaseNotesOnStartup();

    for (const window of windows) {
      expect(window.webContents.send).toHaveBeenCalledWith(RELEASE_NOTES_CHANNELS.SHOW, {
        notes: NOTES,
      });
    }
    expect(await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING)).toEqual({
      success: true,
      data: NOTES,
    });
  });

  it('parks the notes as pending when no window exists at init time', async () => {
    // Regression (intent-hq/monorepo#3054): the startup check must run and
    // park the notes even when the window has not been created yet — the
    // renderer reads them over get-pending once it initializes.
    await initializeReleaseNotesOnStartup();

    expect(await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING)).toEqual({
      success: true,
      data: NOTES,
    });
  });

  it('enumerates the push targets at send time, not at init time', async () => {
    // A window created between check start and fetch completion still
    // receives the push.
    const window = fakeWindow();
    const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');
    vi.mocked(checkForReleaseNotesOnStartup).mockImplementationOnce(async (show) => {
      allWindows = [window]; // window appears while the check is in flight
      show(NOTES);
      return NOTES;
    });

    await initializeReleaseNotesOnStartup();

    expect(window.webContents.send).toHaveBeenCalledWith(RELEASE_NOTES_CHANNELS.SHOW, {
      notes: NOTES,
    });
  });

  it('skips destroyed windows on the startup push', async () => {
    const live = fakeWindow();
    const destroyed = fakeWindow(true);
    allWindows = [destroyed, live];

    await initializeReleaseNotesOnStartup();

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(live.webContents.send).toHaveBeenCalledWith(RELEASE_NOTES_CHANNELS.SHOW, {
      notes: NOTES,
    });
  });

  it('keeps the pending notes readable by every renderer until dismissed', async () => {
    await initializeReleaseNotesOnStartup();

    const first = await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING, { id: 1 });
    const second = await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING, { id: 2 });

    expect(first).toEqual({ success: true, data: NOTES });
    expect(second).toEqual({ success: true, data: NOTES });
  });

  it('clears the pending notes and closes the modal everywhere on dismiss', async () => {
    const windows = [fakeWindow(), fakeWindow()];
    allWindows = windows;
    await initializeReleaseNotesOnStartup();

    expect(await invoke(RELEASE_NOTES_CHANNELS.DISMISS)).toEqual({ success: true });

    for (const window of windows) {
      expect(window.webContents.send).toHaveBeenCalledWith(RELEASE_NOTES_CHANNELS.CLOSE, undefined);
    }
    expect(await invoke(RELEASE_NOTES_CHANNELS.GET_PENDING)).toEqual({
      success: true,
      data: null,
    });
  });

  it('skips destroyed windows on the dismiss fan-out', async () => {
    const live = fakeWindow();
    const destroyed = fakeWindow(true);
    allWindows = [live, destroyed];

    await invoke(RELEASE_NOTES_CHANNELS.DISMISS);

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(live.webContents.send).toHaveBeenCalledWith(RELEASE_NOTES_CHANNELS.CLOSE, undefined);
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
