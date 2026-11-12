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
  holdOk: false,
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
    debug() {}
    info() {}
    warn() {}
  },
}));
vi.mock('../../../shared/main/window-appearance', () => ({
  getWindowAppearanceOptions: () => ({}),
  getWindowTitleBarOptions: () => ({}),
}));
vi.mock('../../../main/fixed-zoom', () => ({ fixWebContentsZoom: () => {} }));
vi.mock('../../../main/dock-window', () => ({
  getDockWindow: () => io.dock,
  adoptDockEditorHold: () => false,
  beginDockEditorHold: () => io.holdOk,
  endDockEditorHold: () => {},
  focusDockForEditorReturn: () => false,
  releaseDockEditorHolds: () => {},
  dockEditorHoldOwner: () => null,
}));
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
    const listeners: Set<() => void> = io.retired.get(wc) ?? new Set();
    io.retired.set(wc, listeners.add(cb));
    return () => listeners.delete(cb);
  },
}));
vi.mock('../../../main/utils/workspace-file-url', () => ({
  parseWorkspaceFileRequest: (raw: string) => {
    const u = new URL(raw);
    return { ok: true, workspaceId: u.host, filePath: u.pathname.slice(1) };
  },
  withWorkspaceMediaBackendHint: (raw: string) => raw,
}));
import { writeFileSync } from 'node:fs';
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
  io.holdOk = false;
  for (const listeners of [...io.retired.values()]) for (const cb of [...listeners]) cb();
  io.retired.clear();
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
    for (const cb of [...io.retired.get(first.dock.webContents)]) cb();
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
  it('a pending Retake blocks Delete and a failed/cancelled retry preserves the source', async () => {
    const { editor, openId, dock } = await open();
    for (const error of ['failed', 'cancelled'] as const) {
      const retaking = invoke(C.RETAKE, editor, { openId });
      const request = dock.webContents.sent.at(-1);
      expect(request.channel).toBe(C.RETAKE_REQUESTED);
      expect(await invoke(C.DELETE, editor, { openId })).toBe(false);
      expect(
        await invoke(C.RETAKE_RESULT, dock, {
          requestId: request.payload.requestId,
          ok: false,
          error,
        }),
      ).toBe(true);
      expect(await retaking).toEqual({ ok: false, error });
      expect(await invoke(C.GET, editor)).toMatchObject({ openId, attachmentId: 'file', source });
    }
    expect(
      dock.webContents.sent.filter(
        (message: { channel: string }) => message.channel === C.RETAKE_REQUESTED,
      ),
    ).toHaveLength(2);
  });
});

describe('screenshot editor entry', () => {
  /**
   * Main's side of a screenshot's editor entry, against fake windows (no native visibility
   * claim): the editor page loads hidden from the press and shows as a loading shell (no
   * session, no media, no action) once the screenshot is taken; OPEN then hands it the
   * admitted session. A capture that opens no editor closes it unseen, and a shell the person
   * closes is never reopened. The timeline is written for the handoff receipt.
   */
  it('shows the editor shell once the screenshot is taken and the session only once admitted', async () => {
    vi.useFakeTimers();
    const timeline: string[] = [];
    const t0 = Date.now();
    const note = (step: string) => timeline.push(`${Date.now() - t0}ms ${step}`);
    const watch = (window: any, name: string) => {
      let visible = false;
      window.isVisible = () => visible;
      window.show = () => ((visible = true), note(`${name} shown`));
      window.close = () => (note(`${name} closed`), window.emit('closed'));
      return window;
    };
    io.dock = new io.Window();
    io.bindings.set(io.dock.webContents, { window: io.dock, backendId: 'backend' });
    setupDockCaptureEditorIPC();
    io.holdOk = true;
    const [cancelled, token] = [crypto.randomUUID(), crypto.randomUUID()];
    // A recording-stop hold (no hide) loads nothing.
    expect(await invoke(C.HOLD_BEGIN, io.dock, { token: crypto.randomUUID() })).toBe(true);
    expect(io.windows).toHaveLength(1);
    // A cancelled screenshot: the editor loaded at the press closes unseen.
    expect(await invoke(C.HOLD_BEGIN, io.dock, { token: cancelled, hide: true })).toBe(true);
    const unused = watch(io.windows.at(-1), 'cancelled editor');
    note('cancelled hold begun, editor loading hidden');
    expect(await invoke(C.HOLD_END, io.dock, { token: cancelled })).toBe(true);
    expect(timeline.at(-1)).toMatch(/cancelled editor closed/);
    expect(timeline.join()).not.toMatch(/cancelled editor shown/);
    expect(unused.webContents.sent).toEqual([]);
    const openFor = (holdToken: string) =>
      invoke(C.OPEN, io.dock, {
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
        holdToken,
      });
    // A loading shell the person closes: that screenshot's editor never opens later.
    const closedToken = crypto.randomUUID();
    expect(await invoke(C.HOLD_BEGIN, io.dock, { token: closedToken, hide: true })).toBe(true);
    const closedShell = watch(io.windows.at(-1), 'closed shell');
    expect(await invoke(C.HOLD_SHOW, io.dock, { token: closedToken })).toBe(true);
    closedShell.close();
    expect(await openFor(closedToken)).toEqual({ ok: false, error: 'cancelled' });
    expect(await invoke(C.HOLD_END, io.dock, { token: closedToken })).toBe(true);
    expect(io.windows.at(-1)).toBe(closedShell);
    // A shell whose dock document retires is discarded at once (not after the idle bound).
    const retiredToken = crypto.randomUUID();
    expect(await invoke(C.HOLD_BEGIN, io.dock, { token: retiredToken, hide: true })).toBe(true);
    const orphan = watch(io.windows.at(-1), 'retired-owner shell');
    expect(await invoke(C.HOLD_SHOW, io.dock, { token: retiredToken })).toBe(true);
    for (const cb of [...io.retired.get(io.dock.webContents)]) cb();
    expect(timeline.at(-1)).toMatch(/retired-owner shell closed/);
    expect(orphan.webContents.sent).toEqual([]);
    expect(await invoke(C.HOLD_END, io.dock, { token: retiredToken })).toBe(true);
    // The screenshot that opens: loaded hidden at the press, inert without a session.
    expect(await invoke(C.HOLD_BEGIN, io.dock, { token, hide: true })).toBe(true);
    const editor = watch(io.windows.at(-1), 'editor');
    note('screenshot pressed: dock hidden, editor loading hidden');
    expect(await invoke(C.GET, editor)).toBeNull();
    vi.advanceTimersByTime(250);
    // Another document's or token's request shows nothing.
    expect(await invoke(C.HOLD_SHOW, io.dock, { token: cancelled })).toBe(false);
    expect(await invoke(C.HOLD_SHOW, editor, { token })).toBe(false);
    expect(editor.isVisible()).toBe(false);
    // The screenshot is taken: the editor shows at once, as a loading shell.
    expect(await invoke(C.HOLD_SHOW, io.dock, { token })).toBe(true);
    note('screenshot taken: editor shell shown (loading, no session)');
    expect(editor.isVisible()).toBe(true);
    expect(await invoke(C.GET, editor)).toBeNull();
    vi.advanceTimersByTime(300);
    note('screenshot durable: OPEN admitted');
    const reply = await openFor(token);
    expect(reply.ok).toBe(true);
    // The same window takes the session; the page is told and draws it.
    expect(io.windows.at(-1)).toBe(editor);
    expect(editor.webContents.sent.map((m: any) => m.channel)).toEqual([C.CHANGED]);
    const snapshot = await invoke(C.GET, editor);
    note('page read the admitted session');
    expect(snapshot.openId).toBe(reply.openId);
    vi.advanceTimersByTime(0);
    expect(timeline.filter((l) => l.endsWith(' editor shown'))).toHaveLength(1);
    // Its own hold ends nothing: the session owns it now.
    expect(await invoke(C.HOLD_END, io.dock, { token })).toBe(true);
    expect(timeline.some((l) => l.endsWith(' editor closed') && !l.includes('cancelled'))).toBe(
      false,
    );
    if (process.env.EDITOR_ENTRY_TIMELINE)
      writeFileSync(process.env.EDITOR_ENTRY_TIMELINE, JSON.stringify({ timeline }, null, 2));
    vi.useRealTimers();
  });
});
