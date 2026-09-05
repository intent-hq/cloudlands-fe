import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VSCODE_CHANNELS } from '../../../../shared/ipc/channels';

type Handler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  withDiffTempFiles: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: vi.fn(),
    fromWebContents: vi.fn(),
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: mocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

vi.mock('../../../ide/main/diff-temp-files.service', () => ({
  withDiffTempFiles: mocks.withDiffTempFiles,
}));

import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = mocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

beforeEach(() => {
  mocks.handle.mockReset();
  mocks.withDiffTempFiles.mockReset().mockResolvedValue(undefined);
  setupSystemIPC();
});

describe('VSCODE_CHANNELS.OPEN_DIFF', () => {
  it('passes renderer names only as display labels to the contained temp-file lifecycle', async () => {
    const result = await handlerFor(VSCODE_CHANNELS.OPEN_DIFF)(
      {},
      {
        oldContent: 'old',
        newContent: 'new',
        oldFileName: '../../outside.ts',
        newFileName: '/tmp/absolute.ts',
        filePath: 'src/example.ts',
      },
    );

    expect(mocks.withDiffTempFiles).toHaveBeenCalledWith(
      {
        oldContent: 'old',
        newContent: 'new',
        oldDisplayLabel: '../../outside.ts',
        newDisplayLabel: '/tmp/absolute.ts',
      },
      expect.any(Function),
      expect.objectContaining({ cleanupDelayMs: 5000 }),
    );
    expect(result).toEqual({ success: true });
  });
});
