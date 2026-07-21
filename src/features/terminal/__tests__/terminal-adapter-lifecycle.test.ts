import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalAdapter } from '../TerminalAdapter';
import type { TerminalsClient } from '$lib/client';

/** Build a TerminalsClient stub that swallows daemon traffic for DOM-focused tests. */
function fakeTerminalsClient(): TerminalsClient {
  return {
    list: vi.fn(async () => []),
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

    constructor(options: any) {
      this.options = options;
      xtermMock.instances.push(this);
    }
  }

  return { Terminal: MockTerminal };
});
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    dispose = vi.fn();
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

  it('removes paste listener and releases detached container references', () => {
    const container = document.createElement('div');
    const addSpy = vi.spyOn(container, 'addEventListener');
    const removeSpy = vi.spyOn(container, 'removeEventListener');
    const terminals = fakeTerminalsClient();
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container,
      appClient: { terminals },
    });

    (adapter as any).setupXTermEventHandlers();
    expect(addSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);

    adapter.detach();

    expect(removeSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);
    expect((adapter as any).container).toBeNull();
    expect((adapter as any).themeManager.container).toBeNull();
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

  it('moves paste listener and theme container on reattach', async () => {
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    const firstRemoveSpy = vi.spyOn(firstContainer, 'removeEventListener');
    const secondAddSpy = vi.spyOn(secondContainer, 'addEventListener');
    const adapter = new TerminalAdapter({
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      container: firstContainer,
      appClient: { terminals: fakeTerminalsClient() },
    });

    (adapter as any).setupXTermEventHandlers();
    await adapter.reattach(secondContainer);

    expect(firstRemoveSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);
    expect(secondAddSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);
    expect((adapter as any).themeManager.container).toBe(secondContainer);

    adapter.detach();
  });

  it('write() forwards xterm onData input through TerminalsClient.write', () => {
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

    adapter.write('ls\n');

    expect(terminals.write).toHaveBeenCalledWith('term-1', 'ls\n');
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
    terminals.list = vi.fn(async () => [
      { id: 'pty-0', name: 'Setup Script', isConnected: true, isExecuting: false },
    ]) as any;
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
    terminals.list = vi.fn(async () => [
      { id: 'pty-0', name: 'Setup Script', isConnected: true, isExecuting: true },
    ]) as any;
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
    terminals.list = vi.fn(async () => [
      { id: 'pty-0', name: 'Setup Script', isConnected: true, isExecuting: false },
    ]) as any;
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
