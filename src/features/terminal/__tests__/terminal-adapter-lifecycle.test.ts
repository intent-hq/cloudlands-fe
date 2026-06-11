import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalAdapter } from '../TerminalAdapter';

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
    const adapter = new TerminalAdapter({ workspaceId: 'ws-1', terminalId: 'term-1', container });

    (adapter as any).setupXTermEventHandlers();
    expect(addSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);

    adapter.detach();

    expect(removeSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);
    expect((adapter as any).container).toBeNull();
    expect((adapter as any).themeManager.container).toBeNull();
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
    });

    (adapter as any).setupXTermEventHandlers();
    await adapter.reattach(secondContainer);

    expect(firstRemoveSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);
    expect(secondAddSpy).toHaveBeenCalledWith('paste', (adapter as any).handlePasteEvent);
    expect((adapter as any).themeManager.container).toBe(secondContainer);

    adapter.detach();
  });
});
