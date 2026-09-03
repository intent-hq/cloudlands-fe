import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  request: vi.fn(),
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      mocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.request }),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { registerExternalEditorsHandlers } from '../external-editors.ipc';

describe('external-editors:open-with-other', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
  });

  it('opens the chooser as a modal owned by the requesting renderer window', async () => {
    const sender = { id: 42 };
    const ownerWindow = { id: 7 };
    mocks.fromWebContents.mockReturnValue(ownerWindow);
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerExternalEditorsHandlers();

    const handler = mocks.handlers.get(IPC_CHANNELS.EXTERNAL_EDITORS.OPEN_WITH_OTHER);
    expect(handler).toBeDefined();

    const response = await handler?.({ sender }, { path: '/repo' });

    expect(mocks.fromWebContents).toHaveBeenCalledWith(sender);
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(
      ownerWindow,
      expect.objectContaining({ title: 'Choose Application', properties: ['openFile'] }),
    );
    expect(response).toEqual({ success: false, error: 'No application selected' });
  });
});
