import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalAdapter } from '../TerminalAdapter';
import type { TerminalsClient } from '$lib/client';

/** Build a TerminalsClient stub that swallows daemon traffic for DOM-focused tests. */
function fakeTerminalsClient(): TerminalsClient {
  return {
    list: vi.fn(async () => ({ terminals: [], daemonBootId: 'boot-test' })),
    create: vi.fn(async () => ({ success: true, id: 'term-1' })),
    write: vi.fn(async () => ({ success: true })),
    resize: vi.fn(async () => ({ success: true })),
    kill: vi.fn(async () => ({ success: true })),
    getBuffer: vi.fn(async () => ''),
    output: vi.fn(async () => ''),
    subscribeEvents: vi.fn(() => () => {}),
    subscribe: vi.fn(() => () => {}),
  };
}

const xtermMock = vi.hoisted(() => ({ instances: [] as any[] }));
const fitMock = vi.hoisted(() => ({ instances: [] as any[] }));

const fontMock = vi.hoisted(() => ({
  current: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    element = document.createElement('div');
    cols = 80;
    rows = 24;
    options: any = {};
    buffer = { active: { length: 0, cursorX: 0, cursorY: 0, getLine: vi.fn() } };
    open = vi.fn((container: HTMLElement) => container.appendChild(this.element));
    loadAddon = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    focus = vi.fn();
    blur = vi.fn();
    clear = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    refresh = vi.fn();
    dispose = vi.fn();
    getSelection = vi.fn(() => '');
    dataHandler?: (data: string) => void;

    constructor(options: any) {
      this.options = options;
      this.onData.mockImplementation((handler: (data: string) => void) => {
        this.dataHandler = handler;
        return { dispose: vi.fn() };
      });
      xtermMock.instances.push(this);
    }
  }

  return { Terminal: MockTerminal };
});
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    dispose = vi.fn();

    constructor() {
      fitMock.instances.push(this);
    }
  },
}));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    dispose = vi.fn();
  },
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = vi.fn();
  },
}));
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    onDidChangeResults = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('../../../shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: vi.fn(), state: {} } }));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: Object.assign(
    () => ({
      subscribe: (fn: (v: string) => void) => {
        fn(fontMock.current);
        return () => undefined;
      },
    }),
    { select: () => fontMock.current },
  ),
}));
vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  closeActiveTerminalRequested: vi.fn((workspaceId: string) => ({ payload: [workspaceId] })),
  toggleTerminalOverlay: vi.fn((workspaceId: string) => ({ payload: [workspaceId] })),
}));
vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: vi.fn() }));
vi.mock('$shared/utils/link-helpers', () => ({ isGitHubUrl: vi.fn(() => false) }));
vi.mock('$shared/utils/sanitize-credentials', () => ({
  sanitizeCommandForDisplay: (value: string) => value,
}));

describe('TerminalAdapter lifecycle cleanup', () => {
  beforeEach(() => {
    xtermMock.instances.length = 0;
    fitMock.instances.length = 0;
    vi.clearAllMocks();
    document.documentElement.classList.remove('dark', 'light');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    });
    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (globalThis as any).IntersectionObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (window as any).electronAPI = {
      invoke: vi.fn().mockResolvedValue({ success: false }),
      on: vi.fn(() => 'listener-id'),
      offById: vi.fn(),
    };
  });

  it('paints the terminal host with the current theme before xterm opens', () => {
    document.documentElement.classList.add('light');
    const container = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
    });

    expect(container.style.backgroundColor).toBe('rgb(247, 247, 248)');

    adapter.detach();
  });

  it('does not register a container-level paste listener (xterm owns paste natively)', () => {
    const container = document.createElement('div');
    const addSpy = vi.spyOn(container, 'addEventListener');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });

    (adapter as any).setupXTermEventHandlers();

    const pasteRegistrations = addSpy.mock.calls.filter(([type]) => type === 'paste');
    expect(pasteRegistrations).toHaveLength(0);

    adapter.detach();
  });

  it('releases detached container references', () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });

    (adapter as any).setupXTermEventHandlers();
    adapter.detach();

    expect((adapter as any).container).toBeNull();
    expect((adapter as any).themeManager.container).toBeNull();
  });

  it('disconnects layout observers while hidden and refits after a hidden resize', async () => {
    const resizeObservers: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor() {
        resizeObservers.push(this);
      }
    };
    let width = 800;
    const container = document.createElement('div');
    container.getBoundingClientRect = vi.fn(() => ({
      width,
      height: 400,
      top: 0,
      right: width,
      bottom: 400,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
    });
    await adapter.initialize();
    const fit = fitMock.instances[0].fit;
    expect(fit).toHaveBeenCalledOnce();

    adapter.setVisible(false);
    expect(resizeObservers.at(-1)?.disconnect).toHaveBeenCalledOnce();
    expect(xtermMock.instances[0].blur).toHaveBeenCalledOnce();

    width = 900;
    adapter.setVisible(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fit).toHaveBeenCalledTimes(2);

    adapter.setVisible(false);
    adapter.setVisible(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fit).toHaveBeenCalledTimes(2);
    adapter.dispose({ killPty: false });
  });

  it('dispose() drops the PTY through the daemon `terminal.kill`', () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });

    adapter.dispose();

    expect(terminals.kill).toHaveBeenCalledWith('term-1');
  });

  it('defers xterm renderer disposal until queued viewport work has drained', async () => {
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container: document.createElement('div'),
      appClient: { terminals: fakeTerminalsClient() },
    });
    const xterm = (adapter as any).xterm;

    adapter.dispose();

    expect(xterm.dispose).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(xterm.dispose).toHaveBeenCalledOnce();
  });

  it('dispose({ killPty: false }) releases renderer resources without killing an exited PTY', async () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });

    adapter.dispose({ killPty: false });

    expect(terminals.kill).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((adapter as any).xterm.dispose).toHaveBeenCalled();
  });

  it('moves theme container on reattach', async () => {
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container: firstContainer,
      appClient: { terminals: fakeTerminalsClient() },
    });

    (adapter as any).setupXTermEventHandlers();
    await adapter.reattach(secondContainer);

    expect((adapter as any).themeManager.container).toBe(secondContainer);

    adapter.detach();
  });

  it('forwards xterm onData DEL unchanged through TerminalsClient.write', () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });
    // Drive the state machine to CONNECTED so write() is accepted.
    (adapter as any).stateMachine.transition('initialize');
    (adapter as any).stateMachine.transition('connect');
    (adapter as any).stateMachine.transition('connected');

    (adapter as any).setupXTermEventHandlers();
    const xterm = (adapter as any).xterm;
    xterm.dataHandler('\x7f');

    expect(terminals.write).toHaveBeenCalledWith('term-1', '\x7f');
  });

  it('passes PTY erase echo unchanged from terminal:data to xterm.write', () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    let capturedHandlers: any;
    terminals.subscribeEvents = vi.fn((_id: string, handlers: any) => {
      capturedHandlers = handlers;
      return () => {};
    }) as any;
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });
    (adapter as any).stateMachine.transition('initialize');
    (adapter as any).stateMachine.transition('connect');
    (adapter as any).stateMachine.transition('connected');
    (adapter as any).setupIpcEventHandlers();

    capturedHandlers.onData({ terminalId: 'term-1', chunk: '\x08 \x08' });

    expect((adapter as any).xterm.write).toHaveBeenCalledWith('\x08 \x08');
  });

  it('resize() forwards dimensions through TerminalsClient.resize', () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });
    (adapter as any).stateMachine.transition('initialize');
    (adapter as any).stateMachine.transition('connect');
    (adapter as any).stateMachine.transition('connected');

    adapter.resize(120, 40);

    expect(terminals.resize).toHaveBeenCalledWith('term-1', 120, 40);
  });
});

describe('TerminalAdapter reattach refit', () => {
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    targets = new Set<Element>();
    observe = vi.fn((target: Element) => {
      this.targets.add(target);
    });
    unobserve = vi.fn((target: Element) => {
      this.targets.delete(target);
    });
    disconnect = vi.fn(() => {
      this.targets.clear();
    });

    constructor(readonly callback: ResizeObserverCallback) {
      FakeResizeObserver.instances.push(this);
    }
  }

  /** Simulate layout reporting a size change on `target` to every observer watching it. */
  function notifyResize(target: Element): void {
    for (const observer of FakeResizeObserver.instances) {
      if (observer.targets.has(target)) {
        observer.callback([{ target } as ResizeObserverEntry], observer as any);
      }
    }
  }

  /** A container whose layout box can be changed by the test after reattach. */
  function sizableContainer(width = 0, height = 0) {
    const element = document.createElement('div');
    let size = { width, height };
    element.getBoundingClientRect = vi.fn(
      () =>
        ({
          ...size,
          top: 0,
          left: 0,
          right: size.width,
          bottom: size.height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    return {
      element,
      setSize(nextWidth: number, nextHeight: number) {
        size = { width: nextWidth, height: nextHeight };
      },
    };
  }

  function createAdapter(container: HTMLElement) {
    return new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    xtermMock.instances.length = 0;
    fitMock.instances.length = 0;
    FakeResizeObserver.instances.length = 0;
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    });
    (globalThis as any).ResizeObserver = FakeResizeObserver;
    (globalThis as any).IntersectionObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (window as any).electronAPI = {
      invoke: vi.fn().mockResolvedValue({ success: false }),
      on: vi.fn(() => 'listener-id'),
      offById: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fits immediately when the new container already has a size', async () => {
    const adapter = createAdapter(sizableContainer(800, 400).element);
    const target = sizableContainer(640, 320);
    const fit = fitMock.instances[0].fit;

    await adapter.reattach(target.element);

    expect(fit).toHaveBeenCalledOnce();
    expect(xtermMock.instances[0].refresh).toHaveBeenCalled();

    adapter.detach();
  });

  it('defers the fit until a 0×0 container gains size, even after the old 50 ms retry window', async () => {
    const adapter = createAdapter(sizableContainer(800, 400).element);
    const target = sizableContainer(0, 0);
    const fit = fitMock.instances[0].fit;
    const xterm = xtermMock.instances[0];

    await adapter.reattach(target.element);
    expect(fit).not.toHaveBeenCalled();

    // The surface is still animating in: the container stays 0×0 well past 50 ms.
    vi.advanceTimersByTime(80);
    expect(fit).not.toHaveBeenCalled();

    // Layout settles: the container reports a size, observers fire, and the
    // size holds for the settle window.
    target.setSize(640, 320);
    notifyResize(target.element);
    vi.advanceTimersByTime(100);

    expect(fit).toHaveBeenCalledOnce();
    expect(xterm.refresh).toHaveBeenCalled();

    adapter.detach();
  });

  it('waits for an animated container to stop changing size before fitting', async () => {
    const adapter = createAdapter(sizableContainer(800, 400).element);
    const target = sizableContainer(0, 0);
    const fit = fitMock.instances[0].fit;

    await adapter.reattach(target.element);

    // Height-animated slide-in: the first reports are a few px tall.
    target.setSize(640, 6);
    notifyResize(target.element);
    vi.advanceTimersByTime(60);
    target.setSize(640, 120);
    notifyResize(target.element);
    vi.advanceTimersByTime(60);
    expect(fit).not.toHaveBeenCalled();

    target.setSize(640, 320);
    notifyResize(target.element);
    vi.advanceTimersByTime(99);
    expect(fit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fit).toHaveBeenCalledOnce();

    // Later size changes are the regular debounced observer's job, not a second reattach fit.
    target.setSize(700, 320);
    notifyResize(target.element);
    vi.advanceTimersByTime(100);
    expect(fit).toHaveBeenCalledTimes(2);
    expect(FakeResizeObserver.instances[0].disconnect).toHaveBeenCalled();

    adapter.detach();
  });

  it('does not fit when the adapter is disposed before the container gains size', async () => {
    const adapter = createAdapter(sizableContainer(800, 400).element);
    const target = sizableContainer(0, 0);
    const fit = fitMock.instances[0].fit;

    await adapter.reattach(target.element);
    adapter.dispose({ killPty: false });

    target.setSize(640, 320);
    notifyResize(target.element);
    vi.advanceTimersByTime(200);

    expect(fit).not.toHaveBeenCalled();
  });

  it('does not fit from hidden layout while the terminal is not visible', async () => {
    const adapter = createAdapter(sizableContainer(800, 400).element);
    const target = sizableContainer(0, 0);
    const fit = fitMock.instances[0].fit;

    await adapter.reattach(target.element);
    adapter.setVisible(false);

    target.setSize(640, 320);
    notifyResize(target.element);
    vi.advanceTimersByTime(200);

    expect(fit).not.toHaveBeenCalled();

    adapter.detach();
  });

  it('cancels a pending refit when the terminal is reattached elsewhere first', async () => {
    const adapter = createAdapter(sizableContainer(800, 400).element);
    const first = sizableContainer(0, 0);
    const second = sizableContainer(640, 320);
    const fit = fitMock.instances[0].fit;

    await adapter.reattach(first.element);
    expect(fit).not.toHaveBeenCalled();
    const pendingObserver = FakeResizeObserver.instances.find((observer) =>
      observer.targets.has(first.element),
    )!;
    expect(pendingObserver).toBeDefined();

    await adapter.reattach(second.element);
    expect(fit).toHaveBeenCalledOnce();
    // Moving on releases the wait on the old container instead of leaving it armed.
    expect(pendingObserver.disconnect).toHaveBeenCalled();

    // The abandoned container gaining size later must not drive another fit.
    first.setSize(500, 250);
    notifyResize(first.element);
    vi.advanceTimersByTime(200);
    expect(fit).toHaveBeenCalledOnce();

    adapter.detach();
  });
});

describe('TerminalAdapter cursor suppression on exit', () => {
  beforeEach(() => {
    xtermMock.instances.length = 0;
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    });
    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (globalThis as any).IntersectionObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (window as any).electronAPI = {
      invoke: vi.fn().mockResolvedValue({ success: false }),
      on: vi.fn(() => 'listener-id'),
      offById: vi.fn(),
    };
  });

  it('disables cursor blink and hides the cursor on live terminal:exit', () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    let capturedHandlers: any;
    terminals.subscribeEvents = vi.fn((_id: string, handlers: any) => {
      capturedHandlers = handlers;
      return () => {};
    }) as any;
    const onExit = vi.fn();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
      onExit,
    });
    (adapter as any).stateMachine.transition('initialize');
    (adapter as any).stateMachine.transition('connect');
    (adapter as any).stateMachine.transition('connected');
    (adapter as any).setupIpcEventHandlers();

    const xterm = (adapter as any).xterm;
    xterm.options.cursorBlink = true;

    capturedHandlers.onExit({ terminalId: 'term-1', exitCode: 0 });

    expect(xterm.options.cursorBlink).toBe(false);
    expect(xterm.write).toHaveBeenCalledWith('\x1b[?25l');
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it('hides the cursor when hydrating a terminal whose backend reports isExecuting=false', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 600 }),
    });
    const terminals = fakeTerminalsClient();
    // Daemon terminal.list shape: already-exited PTY (isExecutingCommand: false
    // on the wire → isExecuting: false on TerminalTab).
    terminals.list = vi.fn(async () => ({
      terminals: [{ id: 'pty-0', name: 'Setup Script', isConnected: true, isExecuting: false }],
      daemonBootId: 'boot-test',
    })) as any;
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'pty-0',
      container,
      appClient: { terminals },
    });

    await adapter.initialize(true);

    const xterm = (adapter as any).xterm;
    expect(xterm.options.cursorBlink).toBe(false);
    expect(xterm.write).toHaveBeenCalledWith('\x1b[?25l');
    // Reconnected to the existing PTY, no new create.
    expect(terminals.create).not.toHaveBeenCalled();
  });

  it('keeps the cursor blinking when hydrating a terminal that is still executing', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 600 }),
    });
    const terminals = fakeTerminalsClient();
    terminals.list = vi.fn(async () => ({
      terminals: [{ id: 'pty-0', name: 'Setup Script', isConnected: true, isExecuting: true }],
      daemonBootId: 'boot-test',
    })) as any;
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'pty-0',
      container,
      appClient: { terminals },
    });

    await adapter.initialize(true);

    const xterm = (adapter as any).xterm;
    expect(xterm.options.cursorBlink).not.toBe(false);
    expect(xterm.write).not.toHaveBeenCalledWith('\x1b[?25l');
  });

  it('keeps the cursor suppressed when reattaching to an already-exited PTY', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 600 }),
    });
    const terminals = fakeTerminalsClient();
    terminals.list = vi.fn(async () => ({
      terminals: [{ id: 'pty-0', name: 'Setup Script', isConnected: true, isExecuting: false }],
      daemonBootId: 'boot-test',
    })) as any;
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'pty-0',
      container,
      appClient: { terminals },
    });
    // Simulate a disconnected adapter being reattached (e.g. tab switch after
    // the process exited while detached).
    (adapter as any).stateMachine.transition('initialize');
    (adapter as any).stateMachine.transition('connect');
    (adapter as any).stateMachine.transition('connected');
    (adapter as any).stateMachine.transition('disconnect');
    const xterm = (adapter as any).xterm;
    xterm.options.cursorBlink = true;
    xterm.write.mockClear();

    await adapter.reattach(container);

    expect(xterm.options.cursorBlink).toBe(false);
    expect(xterm.write).toHaveBeenCalledWith('\x1b[?25l');

    adapter.detach();
  });

  it('restores the cursor when a fresh PTY is created after a previous exit', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 600 }),
    });
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'pty-0',
      container,
      appClient: { terminals },
    });

    // Terminal not on backend → initialize goes through the create path.
    await adapter.initialize(true);

    const xterm = (adapter as any).xterm;
    expect(xterm.options.cursorBlink).toBe(true);
    expect(xterm.write).toHaveBeenCalledWith('\x1b[?25h');
  });
});

describe('TerminalAdapter code-font preference wiring', () => {
  beforeEach(() => {
    xtermMock.instances.length = 0;
    vi.clearAllMocks();
    fontMock.current =
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (globalThis as any).IntersectionObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (window as any).electronAPI = {
      invoke: vi.fn().mockResolvedValue({ success: false }),
      on: vi.fn(() => 'listener-id'),
      offById: vi.fn(),
    };
  });

  it('constructs the XTerm with the canonical system-default selector value when no font is passed', () => {
    const container = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
    });

    const xterm = (adapter as any).xterm;
    expect(xterm.options.fontFamily).toBe(
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
    );

    adapter.detach();
  });

  it('honors an explicit fontFamily option (component-provided) over the selector', () => {
    const container = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
      fontFamily: "'JetBrains Mono', monospace",
    });

    const xterm = (adapter as any).xterm;
    expect(xterm.options.fontFamily).toBe("'JetBrains Mono', monospace");

    adapter.detach();
  });

  it('constructs the XTerm with a named-font selector value', () => {
    fontMock.current = "'Fira Code', monospace";
    const container = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
    });

    const xterm = (adapter as any).xterm;
    expect(xterm.options.fontFamily).toBe("'Fira Code', monospace");

    adapter.detach();
  });

  it('updateFontFamily() updates the live XTerm without creating a new instance or PTY', () => {
    const container = document.createElement('div');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });

    const xtermBefore = (adapter as any).xterm;
    const instanceCountBefore = xtermMock.instances.length;
    const createCallsBefore = (terminals.create as any).mock.calls.length;

    adapter.updateFontFamily("'JetBrains Mono', monospace");

    const xtermAfter = (adapter as any).xterm;
    expect(xtermAfter).toBe(xtermBefore);
    expect(xtermAfter.options.fontFamily).toBe("'JetBrains Mono', monospace");
    expect(xtermMock.instances.length).toBe(instanceCountBefore);
    expect((terminals.create as any).mock.calls.length).toBe(createCallsBefore);

    adapter.detach();
  });

  it('updateFontFamily() is a no-op when the value is unchanged', () => {
    const container = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
    });
    const xterm = (adapter as any).xterm;
    const initial = xterm.options.fontFamily;

    // Replace with a getter/setter to detect writes.
    let writes = 0;
    let stored = initial;
    Object.defineProperty(xterm.options, 'fontFamily', {
      configurable: true,
      get: () => stored,
      set: (v: string) => {
        writes += 1;
        stored = v;
      },
    });

    adapter.updateFontFamily(initial);
    expect(writes).toBe(0);

    adapter.updateFontFamily("'JetBrains Mono', monospace");
    expect(writes).toBe(1);

    adapter.detach();
  });

  it('updateFontFamily() after reattach updates the same XTerm instance (cached adapter path)', async () => {
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container: firstContainer,
      appClient: { terminals: fakeTerminalsClient() },
    });
    const xtermBefore = (adapter as any).xterm;
    const instanceCountBefore = xtermMock.instances.length;

    (adapter as any).setupXTermEventHandlers();
    await adapter.reattach(secondContainer);

    // Component captures a fresh selector value and forwards it after
    // getOrCreateTerminal resolves — the adapter must accept and apply it
    // without disposing/recreating anything.
    adapter.updateFontFamily("'JetBrains Mono', monospace");

    const xtermAfter = (adapter as any).xterm;
    expect(xtermAfter).toBe(xtermBefore);
    expect(xtermAfter.options.fontFamily).toBe("'JetBrains Mono', monospace");
    expect(xtermMock.instances.length).toBe(instanceCountBefore);

    adapter.detach();
  });

  it('updateFontFamily() is a no-op after disposal', () => {
    const container = document.createElement('div');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals: fakeTerminalsClient() },
    });
    const xterm = (adapter as any).xterm;

    adapter.dispose({ killPty: false });
    const before = xterm.options.fontFamily;

    adapter.updateFontFamily("'JetBrains Mono', monospace");

    expect(xterm.options.fontFamily).toBe(before);
  });
});
