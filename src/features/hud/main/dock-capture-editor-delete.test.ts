import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCK_CAPTURE_EDITOR_CHANNELS as C } from '../../../shared/dock-capture-editor';
import { defaultDockMediaEdit } from '../../../shared/dock-media-edit';

const io = vi.hoisted(() => ({
  handlers: new Map(),
  windows: [] as any[],
  bindings: new Map(),
  retired: new Map(),
  dock: null as any,
  Window: null as any,
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Contents extends EventEmitter {
    mainFrame = {};
    destroyed = false;
    sent: { channel: string; payload: any }[] = [];
    isDestroyed = () => this.destroyed;
    isCrashed = () => false;
    send = (channel: string, payload: any) => this.sent.push({ channel, payload });
  }
  class Window extends EventEmitter {
    webContents = new Contents();
    isDestroyed = () => false;
    isVisible = () => true;
    isMinimized = () => false;
    getBounds = () => ({ x: 0, y: 0, width: 400, height: 400 });
    setWindowButtonVisibility = () => {};
    show = () => {};
    focus = () => {};
    hide = () => {};
    loadURL = async () => {};
    close = () => this.emit('closed');
    constructor() {
      super();
      io.windows.push(this);
    }
  }
  io.Window = Window;
  return {
    BrowserWindow: Window,
    ipcMain: { handle: (name: string, fn: unknown) => io.handlers.set(name, fn) },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }) },
  };
});
vi.mock('../../../shared/logger', () => ({
  Logger: class {
    warn() {}
  },
}));
vi.mock('../../../shared/main/window-appearance', () => ({
  getWindowAppearanceOptions: () => ({}),
  getWindowTitleBarOptions: () => ({}),
}));
vi.mock('../../../main/fixed-zoom', () => ({ fixWebContentsZoom: () => {} }));
vi.mock('../../../main/dock-window', () => ({ getDockWindow: () => io.dock }));
vi.mock('../../../main/local-prefs', () => ({
  getDockMediaChoiceLocalPref: async () => null,
  setDockMediaChoiceLocalPref: async () => {},
}));
vi.mock('./dock-media-output', () => ({
  dockMediaOutputReady: async () => ({ ready: true, version: 2 }),
}));
vi.mock('../../../main/dock-capture-editor-identity', () => ({
  noteDockCaptureEditorFocused: () => {},
  registerDockCaptureEditorWindow: () => {},
}));
vi.mock('../../../main/window-backend', () => ({
  getStrictBackendBindingForWebContents: (wc: unknown) => io.bindings.get(wc),
  stampWindowWithBackend: (window: any, backendId: string) =>
    io.bindings.set(window.webContents, { window, backendId }),
  onStrictBackendBindingRetired: (wc: unknown, cb: () => void) => {
    io.retired.set(wc, cb);
    return () => io.retired.delete(wc);
  },
}));
vi.mock('../../../main/utils/workspace-file-url', () => ({
  parseWorkspaceFileRequest: (raw: string) => {
    const u = new URL(raw);
    return { ok: true, workspaceId: u.host, filePath: u.pathname.slice(1) };
  },
  withWorkspaceMediaBackendHint: (raw: string) => raw,
}));
import { setupDockCaptureEditorIPC } from './dock-capture-editor-window';
const source = {
  id: 'source',
  revision: 0,
  kind: 'screenshot' as const,
  attachmentId: 'file',
  path: '.intent/attachments/file.png',
  durationMs: 0,
  width: 400,
  height: 300,
  audio: 'none' as const,
  visuals: 'clean' as const,
  batches: [],
};
const event = (window: any) => ({
  sender: window.webContents,
  senderFrame: window.webContents.mainFrame,
});
const invoke = (name: string, window: Window, value?: unknown) =>
  io.handlers.get(name)(event(window), value);
async function open() {
  io.dock = new io.Window();
  io.bindings.set(io.dock.webContents, { window: io.dock, backendId: 'backend' });
  setupDockCaptureEditorIPC();
  const reply = await invoke(C.OPEN, io.dock, {
    kind: 'screenshot',
    workspaceId: 'workspace',
    agentId: 'agent',
    attachmentId: 'file',
    attachmentPath: source.path,
    sourceRevision: '0',
    title: 'Synthetic',
    source,
    marks: [],
    provenance: { visuals: 'clean' },
  });
  expect(reply.ok).toBe(true);
  return { editor: io.windows.at(-1), openId: reply.openId, dock: io.dock };
}
afterEach(() => {
  for (const cb of [...io.retired.values()]) cb();
  io.handlers.clear();
  io.bindings.clear();
  io.windows = [];
});
describe('editor delete authority and save serialization', () => {
  it('binds source itself, refuses spoofed fields/frames and waits for the exact owner ACK', async () => {
    const { editor, openId, dock } = await open();
    expect(await invoke(C.DELETE, editor, { openId, attachmentId: 'other' })).toBe(false);
    expect(
      await io.handlers.get(C.DELETE)({ sender: editor.webContents, senderFrame: {} }, { openId }),
    ).toBe(false);
    const deleting = invoke(C.DELETE, editor, { openId });
    const request = dock.webContents.sent.at(-1);
    expect(request.channel).toBe(C.DELETE_REQUESTED);
    expect(request.payload).toMatchObject({
      openId,
      pair: { workspaceId: 'workspace', agentId: 'agent' },
      kind: 'screenshot',
      sourceId: 'source',
      sourceRevision: 0,
      attachmentId: 'file',
      expectedEditRevision: 0,
    });
    expect(await invoke(C.CLOSE, editor, { openId })).toBe(false);
    expect(
      await invoke(C.SAVE, editor, { openId, edit: defaultDockMediaEdit(source, [], null) }),
    ).toMatchObject({ result: 'failed' });
    expect(
      await invoke(C.DELETE_RESULT, editor, {
        requestId: request.payload.requestId,
        result: 'deleted',
      }),
    ).toBe(false);
    expect(
      await invoke(C.DELETE_RESULT, dock, {
        requestId: request.payload.requestId,
        result: 'deleted',
      }),
    ).toBe(true);
    expect(await deleting).toBe(true);
    expect(await invoke(C.GET, editor)).toBe(null);
  });
  it('refuses deletion during a durable save, then deletes against the acknowledged revision', async () => {
    const { editor, openId, dock } = await open();
    const edit = defaultDockMediaEdit(source, [], null);
    const saving = invoke(C.SAVE, editor, { openId, edit });
    const save = dock.webContents.sent.at(-1);
    expect(save.channel).toBe(C.SAVE_REQUESTED);
    expect(await invoke(C.DELETE, editor, { openId })).toBe(false);
    expect(dock.webContents.sent.filter((m: any) => m.channel === C.DELETE_REQUESTED)).toHaveLength(
      0,
    );
    await invoke(C.SAVE_RESULT, dock, {
      requestId: save.payload.requestId,
      result: 'saved',
      saved: { ...edit, revision: 1 },
    });
    await saving;
    const deleting = invoke(C.DELETE, editor, { openId });
    const removal = dock.webContents.sent.at(-1);
    expect(removal.payload.expectedEditRevision).toBe(1);
    await invoke(C.DELETE_RESULT, dock, {
      requestId: removal.payload.requestId,
      result: 'deleted',
    });
    expect(await deleting).toBe(true);
  });
  it('a retired owner and late ACK cannot close a new editor session', async () => {
    const first = await open();
    const deleting = invoke(C.DELETE, first.editor, { openId: first.openId });
    const removal = first.dock.webContents.sent.at(-1);
    io.retired.get(first.dock.webContents)();
    expect(await deleting).toBe(false);
    const next = await open();
    expect(
      await invoke(C.DELETE_RESULT, first.dock, {
        requestId: removal.payload.requestId,
        result: 'deleted',
      }),
    ).toBe(false);
    expect(await invoke(C.GET, next.editor)).toMatchObject({ openId: next.openId });
  });
});
