import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: any[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
  getFocusedWindow: vi.fn(),
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: electronMocks.getFocusedWindow,
    fromWebContents: electronMocks.fromWebContents,
  },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showMessageBox: vi.fn(),
  },
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
}));

vi.mock('../../../../shared/main/host-exec', () => ({ hostExec: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({ hostExecStream: vi.fn() }));

import { mkdtemp, readFile, writeFile, mkdir, symlink, truncate, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_NOTIFICATION_SOUND_BYTES } from '../../../../shared/notification-audio';
import { DIALOG_CHANNELS, NOTIFICATION_CHANNELS } from '../../../../shared/ipc/channels';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('dialog:open IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSystemIPC();
  });

  it('opens a directory-only native dialog and returns selected paths', async () => {
    const focusedWindow = { id: 1 };
    electronMocks.getFocusedWindow.mockReturnValue(focusedWindow);
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/project'],
    });

    const result = await handlerFor(DIALOG_CHANNELS.OPEN)(
      { sender: {} },
      {
        title: 'Choose a folder',
        defaultPath: '/tmp',
      },
    );

    expect(result).toEqual(['/tmp/project']);
    expect(electronMocks.showOpenDialog).toHaveBeenCalledExactlyOnceWith(focusedWindow, {
      title: 'Choose a folder',
      defaultPath: '/tmp',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('opens a file-only native dialog when mode is file', async () => {
    const focusedWindow = { id: 1 };
    electronMocks.getFocusedWindow.mockReturnValue(focusedWindow);
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/key.pem'],
    });

    const result = await handlerFor(DIALOG_CHANNELS.OPEN)(
      { sender: {} },
      {
        title: 'Choose a file',
        defaultPath: '/tmp',
        mode: 'file',
      },
    );

    expect(result).toEqual(['/tmp/key.pem']);
    expect(electronMocks.showOpenDialog).toHaveBeenCalledExactlyOnceWith(focusedWindow, {
      title: 'Choose a file',
      defaultPath: '/tmp',
      properties: ['openFile'],
    });
  });

  it('returns null when the dialog is cancelled', async () => {
    electronMocks.getFocusedWindow.mockReturnValue(undefined);
    electronMocks.fromWebContents.mockReturnValue(undefined);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(handlerFor(DIALOG_CHANNELS.OPEN)({ sender: {} }, {})).resolves.toBeNull();
    expect(electronMocks.showOpenDialog).toHaveBeenCalledExactlyOnceWith({
      title: undefined,
      defaultPath: undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
  });
});

describe('desktop notification audio IPC', () => {
  let directory: string;
  let mp3: string;
  let event: { sender: { mainFrame: object }; senderFrame: object };
  let owner: { id: number; webContents: object };
  let audio: Buffer;

  beforeEach(async () => {
    vi.clearAllMocks();
    setupSystemIPC();
    directory = await mkdtemp(join(tmpdir(), 'notification-audio-'));
    mp3 = join(directory, '音声.MP3');
    audio = await readFile(join(__dirname, '../../../../assets/sounds/hud/status-update.mp3'));
    await writeFile(mp3, audio);
    const frame = {};
    event = { sender: { mainFrame: frame }, senderFrame: frame };
    owner = { id: 8, webContents: event.sender };
    electronMocks.fromWebContents.mockReturnValue(owner);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('uses a single-file MP3-only native picker owned by the sender and returns the selected path', async () => {
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [mp3] });
    expect(await handlerFor(NOTIFICATION_CHANNELS.PICK_SOUND)(event, {})).toEqual({
      success: true,
      data: mp3,
    });
    expect(electronMocks.showOpenDialog).toHaveBeenCalledExactlyOnceWith(owner, {
      title: expect.any(String),
      properties: ['openFile'],
      filters: [{ name: expect.any(String), extensions: ['mp3'] }],
    });
  });

  it('returns cancellation distinctly and rejects non-MP3 or multiple choices', async () => {
    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await handlerFor(NOTIFICATION_CHANNELS.PICK_SOUND)(event, {})).toEqual({
      success: true,
      data: null,
    });
    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [mp3, mp3] });
    expect(await handlerFor(NOTIFICATION_CHANNELS.PICK_SOUND)(event, {})).toEqual({
      success: false,
    });
    const wav = join(directory, 'other.wav');
    await writeFile(wav, audio);
    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [wav] });
    expect(await handlerFor(NOTIFICATION_CHANNELS.PICK_SOUND)(event, {})).toEqual({
      success: false,
    });
  });

  it('reads local MP3 audio only, stripping ID3 metadata from the returned payload', async () => {
    // A known MPEG Layer III frame prefix behind a short ID3 tag.
    const frames = Buffer.from([0xff, 0xfb, 0x90, 0, 1, 2, 3, 4]);
    await writeFile(
      mp3,
      Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 3]), Buffer.from('tag'), frames]),
    );
    expect(await handlerFor(NOTIFICATION_CHANNELS.READ_SOUND)(event, { path: mp3 })).toEqual({
      success: true,
      data: frames.toString('base64'),
    });
  });

  it('rejects missing, nonregular, oversized, mislabeled, and symlinked non-audio files safely', async () => {
    const dir = join(directory, 'folder.mp3');
    const invalid = join(directory, 'invalid.mp3');
    const huge = join(directory, 'huge.mp3');
    const secret = join(directory, 'private.txt');
    const alias = join(directory, 'alias.mp3');
    await mkdir(dir);
    await writeFile(invalid, 'not audio');
    await writeFile(huge, audio);
    await truncate(huge, MAX_NOTIFICATION_SOUND_BYTES + 1);
    await writeFile(secret, audio);
    await symlink(secret, alias);
    for (const path of [join(directory, 'missing.mp3'), dir, invalid, huge, alias]) {
      expect(await handlerFor(NOTIFICATION_CHANNELS.READ_SOUND)(event, { path })).toEqual({
        success: false,
      });
    }
  });

  it.each([
    'relative.mp3',
    'https://example.com/a.mp3',
    'file:///tmp/a.mp3',
    '/tmp/a.wav',
    '\\\\server\\a.mp3',
    '/tmp/a.mp3\0',
  ])('rejects invalid request path %s', async (path) => {
    expect(await handlerFor(NOTIFICATION_CHANNELS.READ_SOUND)(event, { path })).toMatchObject({
      success: false,
    });
  });

  it('rejects extra request fields, subframes and embedded web contents', async () => {
    expect(
      await handlerFor(NOTIFICATION_CHANNELS.READ_SOUND)(event, {
        path: mp3,
        workspaceId: 'remote',
      }),
    ).toMatchObject({ success: false });
    expect(
      await handlerFor(NOTIFICATION_CHANNELS.PICK_SOUND)(event, { mode: 'directory' }),
    ).toMatchObject({ success: false });
    expect(
      await handlerFor(NOTIFICATION_CHANNELS.READ_SOUND)(
        { ...event, senderFrame: {} },
        { path: mp3 },
      ),
    ).toEqual({ success: false });
    electronMocks.fromWebContents.mockReturnValue({ id: 8, webContents: {} });
    expect(await handlerFor(NOTIFICATION_CHANNELS.READ_SOUND)(event, { path: mp3 })).toEqual({
      success: false,
    });
    expect(await handlerFor(NOTIFICATION_CHANNELS.PICK_SOUND)(event, {})).toEqual({
      success: false,
    });
    expect(electronMocks.showOpenDialog).not.toHaveBeenCalled();
  });
});
