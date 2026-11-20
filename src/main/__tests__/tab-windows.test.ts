import { EventEmitter } from 'events';
import type { BrowserWindow, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { TabWindowRegistry, type TabWindowRegistryDeps } from '../tab-windows';
import type { TabWindowRecord, TabWindowTab as PanelTab } from '../../shared/types/tab-window';

vi.mock('../../shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const RETURN_TAB = 'tab-window:return-tab';
const TAB_UPDATED = 'tab-window:tab-updated';
const CLOSED_TAB = 'tab-window:closed-tab';

/** A fake window: `close` emits a preventable `close`, then `closed` unless prevented. */
class FakeWindow extends EventEmitter {
  destroyed = false;
  fullScreen = false;
  readonly renderer = { isDestroyed: () => false } as unknown as WebContents;
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly restore = vi.fn();
  readonly setFullScreen = vi.fn((value: boolean) => {
    this.fullScreen = value;
    if (value) queueMicrotask(() => this.emit('enter-full-screen'));
  });
  isDestroyed = () => this.destroyed;
  isMinimized = () => false;
  isFullScreen = () => this.fullScreen;
  close(): void {
    if (this.destroyed) return;
    let prevented = false;
    this.emit('close', { preventDefault: () => (prevented = true) });
    if (prevented) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

const asWindow = (window: FakeWindow) => window as unknown as BrowserWindow;

function browserTab(id = 'tab-1'): PanelTab {
  return {
    id,
    type: 'browser',
    title: 'Page',
    closable: true,
    browserUrl: 'https://example.com/',
  };
}

function setup(overrides: Partial<TabWindowRegistryDeps> = {}) {
  const source = new FakeWindow();
  const opened: FakeWindow[] = [];
  const sent: Array<{ window: FakeWindow | null; channel: string; payload: unknown }> = [];
  const pageWindow = new Map<string, unknown>();
  const destroyedPages: string[] = [];
  let quitting = false;
  let target: FakeWindow | null = source;
  let ids = 0;
  const rendererOwners = new Map<WebContents, FakeWindow>();
  const deps: TabWindowRegistryDeps = {
    openFrame: vi.fn(async () => {
      const window = new FakeWindow();
      opened.push(window);
      return asWindow(window);
    }),
    rendererFor: (window) => {
      const fake = window as unknown as FakeWindow;
      rendererOwners.set(fake.renderer, fake);
      return fake.renderer;
    },
    returnTarget: (_backendId, preferred) =>
      (preferred as unknown as FakeWindow | null) && !preferred?.isDestroyed()
        ? preferred
        : target && !target.destroyed
          ? asWindow(target)
          : null,
    openReturnFrame: vi.fn(async () => {
      target = new FakeWindow();
      return asWindow(target);
    }),
    moveBrowserPage: (tabId, window) => pageWindow.set(tabId, window),
    destroyBrowserPage: (tabId) => destroyedPages.push(tabId),
    browserPageOwner: (tabId) =>
      pageWindow.has(tabId) || tabId === 'tab-1'
        ? {
            backendId: 'local',
            workspaceId: 'ws-1',
            window: (pageWindow.get(tabId) as BrowserWindow | undefined) ?? asWindow(source),
          }
        : null,
    isQuitting: () => quitting,
    displayMode: 'full-screen',
    isMac: false,
    newId: () => `main-id-${++ids}`,
    send: (renderer, channel, payload) =>
      sent.push({ window: rendererOwners.get(renderer) ?? null, channel, payload }),
    ...overrides,
  };
  const registry = new TabWindowRegistry(deps);
  return {
    registry,
    deps,
    source,
    opened,
    sent,
    pageWindow,
    destroyedPages,
    quit: () => (quitting = true),
    setTarget: (next: FakeWindow | null) => (target = next),
  };
}

async function openBrowserTab(ctx: ReturnType<typeof setup>, tab = browserTab()) {
  const id = await ctx.registry.open(asWindow(ctx.source), 'local', {
    tabWindowId: 'tw-1',
    workspaceId: 'ws-1',
    sourceLayoutId: 'ws-1',
    tab,
  });
  return { id, window: ctx.opened.at(-1)! };
}

describe('TabWindowRegistry', () => {
  it('opens a frame at the tab window page and moves the browser page there', async () => {
    const ctx = setup();
    const { id, window } = await openBrowserTab(ctx);
    expect(id).toBe('tw-1');
    expect(ctx.deps.openFrame).toHaveBeenCalledWith('local', '/tab-window/tw-1', 'full-screen');
    expect(ctx.pageWindow.get('tab-1')).toBe(window);
    expect(ctx.registry.recordFor(asWindow(window))).toEqual({
      tabWindowId: 'tw-1',
      workspaceId: 'ws-1',
      sourceLayoutId: 'ws-1',
      tab: browserTab(),
    });
    expect(ctx.registry.status('tw-1')).toEqual({ open: true, closed: false });
  });

  it('a tab that already has a window brings that window up instead of opening another', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    const again = await ctx.registry.open(asWindow(ctx.source), 'local', {
      tabWindowId: 'tw-2',
      workspaceId: 'ws-1',
      sourceLayoutId: 'ws-1',
      tab: browserTab(),
    });
    expect(again).toBe('tw-1');
    expect(ctx.opened).toHaveLength(1);
    expect(window.focus).toHaveBeenCalled();
  });

  it('uses its own id when the renderer id is malformed or taken', async () => {
    const ctx = setup();
    const id = await ctx.registry.open(asWindow(ctx.source), 'local', {
      tabWindowId: '../bad',
      workspaceId: 'ws-1',
      sourceLayoutId: 'ws-1',
      tab: browserTab(),
    });
    expect(id).toBe('main-id-1');
  });

  it('move back: the page moves back before the window closes, then the source shows the tab', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    const order: string[] = [];
    window.on('closed', () => order.push('closed'));
    ctx.deps.moveBrowserPage = vi.fn((tabId: string, target: BrowserWindow) => {
      order.push('moved');
      ctx.pageWindow.set(tabId, target);
    });
    ctx.registry.moveBack(asWindow(window));
    // A closed window destroys the pages it still holds: the move comes first.
    expect(order).toEqual(['moved', 'closed']);
    expect(ctx.pageWindow.get('tab-1')).toBe(ctx.source);
    expect(window.destroyed).toBe(true);
    const returned = ctx.sent.find((m) => m.channel === RETURN_TAB);
    expect(returned?.window).toBe(ctx.source);
    expect(returned?.payload).toMatchObject({
      tabWindowId: 'tw-1',
      workspaceId: 'ws-1',
      sourceLayoutId: 'ws-1',
      reveal: true,
      tab: { id: 'tab-1' },
    });
    expect(ctx.source.focus).toHaveBeenCalled();
    expect(ctx.registry.status('tw-1')).toEqual({ open: false, closed: false });
  });

  it('closing the window (OS close, Cmd+W) moves the tab back without revealing its workspace', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    window.close();
    const returned = ctx.sent.find((m) => m.channel === RETURN_TAB);
    expect(returned?.payload).toMatchObject({ reveal: false, tab: { id: 'tab-1' } });
    expect(ctx.pageWindow.get('tab-1')).toBe(ctx.source);
    expect(ctx.source.focus).not.toHaveBeenCalled();
  });

  it('with the source window gone, another frame of the machine takes the tab', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    const other = new FakeWindow();
    ctx.source.close();
    ctx.setTarget(other);
    window.close();
    expect(ctx.pageWindow.get('tab-1')).toBe(other);
    expect(ctx.sent.find((m) => m.channel === RETURN_TAB)?.window).toBe(other);
  });

  it('with no frame left, the close waits for a new frame, then moves the tab there', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    ctx.source.close();
    ctx.setTarget(null);
    window.close();
    expect(window.destroyed).toBe(false);
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
    expect(ctx.deps.openReturnFrame).toHaveBeenCalledWith('local');
    const returned = ctx.sent.find((m) => m.channel === RETURN_TAB);
    expect(returned).toBeDefined();
    expect(ctx.pageWindow.get('tab-1')).toBe(returned?.window);
  });

  it('close tab: the page closes, the source drops its copy, and the id reads as closed', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    ctx.registry.closeTab(asWindow(window));
    expect(ctx.destroyedPages).toEqual(['tab-1']);
    expect(window.destroyed).toBe(true);
    expect(ctx.sent.map((m) => m.channel)).toEqual([CLOSED_TAB]);
    expect(ctx.sent[0].payload).toEqual({
      tabWindowId: 'tw-1',
      workspaceId: 'ws-1',
      sourceLayoutId: 'ws-1',
      tabId: 'tab-1',
    });
    expect(ctx.registry.status('tw-1')).toEqual({ open: false, closed: true });
  });

  it('quit: a closing tab window is kept for the saved frames, not moved back', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    ctx.quit();
    window.close();
    expect(ctx.sent).toEqual([]);
    expect(ctx.pageWindow.get('tab-1')).toBe(window);
  });

  it('reports tab changes to the source, keeping the id', async () => {
    const ctx = setup();
    const { window } = await openBrowserTab(ctx);
    ctx.registry.update(asWindow(window), {
      ...browserTab(),
      title: 'New title',
      browserUrl: 'https://example.com/next',
    });
    ctx.registry.update(asWindow(window), { ...browserTab('other'), title: 'ignored' });
    const updates = ctx.sent.filter((m) => m.channel === TAB_UPDATED);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({
      tab: { id: 'tab-1', title: 'New title', browserUrl: 'https://example.com/next' },
    });
    expect(ctx.registry.recordFor(asWindow(window))?.tab.title).toBe('New title');
  });

  it('macOS: the source window enters full screen before the tab window opens', async () => {
    const ctx = setup({ isMac: true });
    const order: string[] = [];
    ctx.source.on('enter-full-screen', () => order.push('source-full-screen'));
    (ctx.deps.openFrame as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push('open-frame');
      const window = new FakeWindow();
      ctx.opened.push(window);
      return asWindow(window);
    });
    await openBrowserTab(ctx);
    expect(ctx.source.setFullScreen).toHaveBeenCalledWith(true);
    expect(order).toEqual(['source-full-screen', 'open-frame']);
  });

  it('a failed open forgets the tab window', async () => {
    const ctx = setup({ openFrame: vi.fn(async () => Promise.reject(new Error('no window'))) });
    await expect(openBrowserTab(ctx)).rejects.toThrow('no window');
    expect(ctx.registry.status('tw-1').open).toBe(false);
  });

  it('non-browser tabs open and move back without touching browser pages', async () => {
    const ctx = setup();
    const moves = vi.fn();
    const registry = new TabWindowRegistry({ ...ctx.deps, moveBrowserPage: moves });
    // Fields beyond TabWindowTab (here the terminal id) pass through unchanged.
    const terminal = {
      id: 'term-1',
      type: 'terminal',
      title: 'Shell',
      closable: true,
      terminalId: 't1',
    };
    await registry.open(asWindow(ctx.source), 'local', {
      tabWindowId: 'tw-9',
      workspaceId: 'ws-1',
      sourceLayoutId: 'ws-1',
      tab: terminal,
    });
    ctx.opened.at(-1)!.close();
    expect(moves).not.toHaveBeenCalled();
    expect(ctx.sent.find((m) => m.channel === RETURN_TAB)?.payload).toMatchObject({
      tab: { id: 'term-1', terminalId: 't1' },
    });
  });

  describe('page ownership (browser pages are keyed by tab id across machines)', () => {
    const owned = (owner: { backendId?: string; workspaceId?: string; window?: FakeWindow }) =>
      setup({
        browserPageOwner: () => ({
          backendId: owner.backendId ?? 'local',
          workspaceId: owner.workspaceId ?? 'ws-1',
          window: asWindow(owner.window ?? new FakeWindow()),
        }),
      });

    it.each([
      ['another machine', { backendId: 'remote-1' }, 'another workspace'],
      ['another workspace', { workspaceId: 'ws-2' }, 'another workspace'],
    ] as const)('refuses a page of %s and leaves it alone', async (_label, owner, message) => {
      const ctx = owned(owner);
      ctx.deps.browserPageOwner = vi.fn(() => ({
        backendId: owner.backendId ?? 'local',
        workspaceId: owner.workspaceId ?? 'ws-1',
        window: asWindow(ctx.source),
      }));
      await expect(openBrowserTab(ctx)).rejects.toThrow(message);
      expect(ctx.deps.openFrame).not.toHaveBeenCalled();
      expect(ctx.pageWindow.size).toBe(0);
      expect(ctx.registry.status('tw-1').open).toBe(false);
    });

    it('refuses a page that lives in another window', async () => {
      const ctx = owned({ window: new FakeWindow() });
      await expect(openBrowserTab(ctx)).rejects.toThrow('another window');
      expect(ctx.deps.openFrame).not.toHaveBeenCalled();
      expect(ctx.pageWindow.size).toBe(0);
    });

    it("a tab id already in another machine's tab window is refused, not focused", async () => {
      const ctx = setup();
      const { window } = await openBrowserTab(ctx);
      await expect(
        ctx.registry.open(asWindow(ctx.source), 'remote-1', {
          tabWindowId: 'tw-2',
          workspaceId: 'ws-1',
          sourceLayoutId: 'ws-1',
          tab: browserTab(),
        }),
      ).rejects.toThrow('another workspace');
      expect(window.focus).not.toHaveBeenCalled();
    });

    it('a tab with no page (another tab type) needs no page owner', async () => {
      const ctx = setup({ browserPageOwner: () => null });
      await expect(openBrowserTab(ctx)).resolves.toMatchObject({ id: 'tw-1' });
    });
  });

  describe('restart', () => {
    const record: TabWindowRecord = {
      tabWindowId: 'tw-saved',
      workspaceId: 'ws-1',
      sourceLayoutId: 'ws-1',
      tab: browserTab(),
    };

    it('a saved tab window counts as open while it reopens, then attaches its window', () => {
      const ctx = setup();
      expect(ctx.registry.willRestore(record, 'local')).toBe(true);
      // Idempotent: the restore loop registers early, the frame open registers again.
      expect(ctx.registry.willRestore(record, 'local')).toBe(true);
      expect(ctx.registry.status('tw-saved')).toEqual({ open: true, closed: false });
      const window = new FakeWindow();
      ctx.registry.restored(asWindow(window), 'tw-saved');
      expect(ctx.registry.sessionFor(asWindow(window))).toEqual(record);
      expect(ctx.pageWindow.get('tab-1')).toBe(window);
    });

    it('a saved tab window whose tab is already in another window does not come back', async () => {
      const ctx = setup();
      await openBrowserTab(ctx);
      expect(ctx.registry.willRestore(record, 'local')).toBe(false);
    });

    it('a saved tab window that could not reopen sends its tab back', () => {
      const ctx = setup();
      ctx.registry.willRestore(record, 'local');
      ctx.registry.restoreFailed('tw-saved');
      expect(ctx.registry.status('tw-saved').open).toBe(false);
      expect(ctx.sent.find((m) => m.channel === RETURN_TAB)?.payload).toMatchObject({
        tabWindowId: 'tw-saved',
        reveal: false,
      });
    });
  });
});
