import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
}));

const fontListMocks = vi.hoisted(() => ({
  getFonts: vi.fn(),
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
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock('font-list', () => ({
  default: { getFonts: fontListMocks.getFonts },
  getFonts: fontListMocks.getFonts,
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
import { m } from '../../../../shared/paraglide/messages.js';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('system:list-fonts IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSystemIPC();
  });

  it('returns every normalized font family in deterministic order without monospace filtering', async () => {
    fontListMocks.getFonts.mockResolvedValue([
      '"Times New Roman"',
      "'JetBrains Mono'",
      'Arial',
      '"Arial"',
      'Menlo',
      'Courier New',
      "'Times New Roman'",
    ]);

    const result = await handlerFor(SYSTEM_CHANNELS.LIST_FONTS)({}, {});

    expect(result).toEqual({
      success: true,
      data: ['Arial', 'Courier New', 'JetBrains Mono', 'Menlo', 'Times New Roman'],
    });
  });

  it('returns the existing localized failure response when font enumeration fails', async () => {
    fontListMocks.getFonts.mockRejectedValue(new Error('font enumeration failed'));

    const result = await handlerFor(SYSTEM_CHANNELS.LIST_FONTS)({}, {});

    expect(result).toEqual({
      success: false,
      error: m.system_ipc_enumerateFontsFailed_error(),
    });
  });
});
