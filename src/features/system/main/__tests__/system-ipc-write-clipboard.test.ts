import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the `system:write-clipboard` handler: Electron 44 makes
 * `clipboard.writeText` asynchronous in the main process, so the handler must
 * await it for a rejected write to reach the `catch` and produce a failure
 * response instead of a premature `{ success: true }`.
 */

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
  clipboardWriteText: vi.fn(),
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
    getFocusedWindow: vi.fn(() => undefined),
    fromWebContents: vi.fn(() => undefined),
  },
  clipboard: { writeText: electronMocks.clipboardWriteText },
  dialog: {},
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
vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

import { SYSTEM_CHANNELS } from '../../../../shared/ipc/channels';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('system:write-clipboard IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSystemIPC();
  });

  it('writes the requested text and reports success once the async write settles', async () => {
    let settled = false;
    electronMocks.clipboardWriteText.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            settled = true;
            resolve();
          }, 0);
        }),
    );

    const result = await handlerFor(SYSTEM_CHANNELS.WRITE_CLIPBOARD)({}, { text: 'hello' });

    expect(electronMocks.clipboardWriteText).toHaveBeenCalledWith('hello');
    expect(settled).toBe(true);
    expect(result).toEqual({ success: true });
  });

  it('returns a failure response when the async clipboard write rejects', async () => {
    electronMocks.clipboardWriteText.mockRejectedValue(new Error('clipboard unavailable'));

    const result = await handlerFor(SYSTEM_CHANNELS.WRITE_CLIPBOARD)({}, { text: 'hello' });

    expect(result).toEqual({ success: false, error: 'clipboard unavailable' });
  });
});
