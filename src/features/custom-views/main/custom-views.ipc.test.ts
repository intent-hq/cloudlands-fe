// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { CustomViewsService } from './custom-views.service';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>(),
  owner: vi.fn(),
  session: {},
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  BrowserWindow: { fromWebContents: mocks.owner },
  session: { defaultSession: mocks.session },
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, payload?: unknown) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
}));

import { setupCustomViewsIPC, disposeCustomViews } from './custom-views.ipc';
import { validateIpcRequest } from '../../../shared/ipc/request-validation';
import { getAllowedChannels } from '../../../shared/ipc-registry';

describe('custom views IPC', () => {
  const response = { success: true, data: { views: [], runtimes: [] } };
  const service = {
    list: vi.fn(async () => response),
    save: vi.fn(async () => response),
    remove: vi.fn(async () => response),
    start: vi.fn(async () => response),
    stop: vi.fn(async () => response),
    dispose: vi.fn(async () => {}),
  };
  function event() {
    const mainFrame = { url: 'app://workspaces/' };
    const sender = {
      mainFrame,
      session: mocks.session,
      isDestroyed: () => false,
      getType: () => 'window',
    };
    mocks.owner.mockReturnValue({ webContents: sender, isDestroyed: () => false });
    return { sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    setupCustomViewsIPC(service as unknown as CustomViewsService);
  });

  it('registers all allowlisted commands and preserves exact payloads and snapshots', async () => {
    const input = {
      name: 'Local',
      directory: '/tmp/server',
      command: 'pnpm dev',
      port: 4000,
      icon: 'globe',
    };
    for (const action of ['list', 'save', 'remove', 'start', 'stop'] as const) {
      const channel = `custom-views:${action}` as const;
      const payload =
        action === 'list'
          ? undefined
          : action === 'save'
            ? input
            : { id: 'be2863d7-2e79-4ed4-a77f-29fa1fbf263d' };
      expect(getAllowedChannels()).toContain(channel);
      expect(validateIpcRequest(channel, payload)).toEqual(payload);
      expect(await mocks.handlers.get(channel)!(event(), payload)).toEqual(response);
      if (action === 'list') expect(service.list).toHaveBeenCalledWith();
      else expect(service[action]).toHaveBeenCalledWith(payload);
    }
    await disposeCustomViews();
    expect(service.dispose).toHaveBeenCalledOnce();
  });

  it('rejects subframes, browser guests, unknown windows and untrusted navigation on every channel', async () => {
    for (const action of ['list', 'save', 'remove', 'start', 'stop'] as const) {
      for (const kind of [
        'subframe',
        'guest',
        'unknown-window',
        'wrong-session',
        'remote-url',
        'bridge',
      ]) {
        const context = event();
        if (kind === 'subframe')
          Object.assign(context, { senderFrame: { url: 'http://127.0.0.1:4000/' } });
        if (kind === 'guest') Object.assign(context.sender, { getType: () => 'webview' });
        if (kind === 'unknown-window') mocks.owner.mockReturnValue(null);
        if (kind === 'wrong-session') Object.assign(context.sender, { session: {} });
        if (kind === 'remote-url')
          Object.assign(context.senderFrame!, { url: 'https://example.com/' });
        const result = await mocks.handlers.get(`custom-views:${action}`)!(
          kind === 'bridge' ? ({} as IpcMainInvokeEvent) : context,
        );
        expect(result).toMatchObject({ success: false, error: { code: 'invalid-input' } });
      }
      expect(service[action]).not.toHaveBeenCalled();
    }
  });

  it('requires the no-payload list contract and validates registered input schemas', async () => {
    expect(await mocks.handlers.get('custom-views:list')!(event(), {})).toMatchObject({
      success: false,
    });
    expect(service.list).not.toHaveBeenCalled();
    expect(() =>
      validateIpcRequest('custom-views:start', { id: 'bad', command: 'injected' }),
    ).toThrow();
    expect(() =>
      validateIpcRequest('custom-views:save', {
        name: 'Valid',
        directory: '/',
        command: 'start',
        port: 80,
        icon: 'globe',
      }),
    ).toThrow();
  });
});
