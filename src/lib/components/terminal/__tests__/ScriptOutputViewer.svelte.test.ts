/**
 * Regression tests for `ScriptOutputViewer.svelte` code-font wiring
 * (verifier follow-up).
 *
 * Mounts the real Svelte component with a mocked `@xterm/xterm` that captures
 * constructor options, retains one observable options object, and exposes
 * `dispose` / `write` spies. Scripts selectors, the code-font selector
 * readable, ResizeObserver, and requestAnimationFrame are also mocked so
 * `initXterm()` runs to completion in the non-empty state and later effects
 * fire deterministically.
 *
 * These tests prove:
 *   1. The XTerm constructor receives the current code-font preference.
 *   2. Later readable changes mutate `fontFamily` on the SAME XTerm — no
 *      second construction, no `dispose()`, and no extra output writes
 *      (i.e. no replay / `writtenChunkCount` reset).
 *
 * Regressing ScriptOutputViewer.svelte:92 back to a hardcoded string or
 * removing the live font `$effect` (lines 208–213) still passes every
 * adapter-only test but fails here.
 */
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SYSTEM_DEFAULT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

const { xtermMock, fontReadableRef, scriptState } = vi.hoisted(() => ({
  xtermMock: { instances: [] as any[], constructorOptions: [] as any[] },
  fontReadableRef: { value: null as any },
  scriptState: {
    script: {
      id: 's-1',
      workspaceId: 'ws-1',
      name: 'dev',
      command: 'pnpm dev',
      mode: 'service',
      source: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      runtime: { status: 'running', pid: 123, exitCode: null, restartCount: 0 },
    },
    runtime: { status: 'running', pid: 123, exitCode: null, restartCount: 0 },
    output: {
      chunks: [{ text: 'hello\n', timestamp: '2026-01-01T00:00:00.000Z' }],
      dropped: 0,
    },
  },
}));

function createControllableReadable<T>(initial: T) {
  let current = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    subscribe(fn: (v: T) => void) {
      fn(current);
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set(v: T) {
      current = v;
      for (const fn of listeners) fn(current);
    },
    get value() {
      return current;
    },
  };
}

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    element = document.createElement('div');
    options: any;
    open = vi.fn((container: HTMLElement) => container.appendChild(this.element));
    loadAddon = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    focus = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    constructor(options: any) {
      this.options = { ...options };
      xtermMock.constructorOptions.push(options);
      xtermMock.instances.push(this);
    }
  }
  return { Terminal: MockTerminal };
});
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));

vi.mock('$features/terminal/terminal-theme-manager', () => ({
  TerminalThemeManager: class {
    getCurrentTheme() {
      return {};
    }
    applyTheme = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: { start: vi.fn(), remove: vi.fn() },
}));

vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => {
  const makeSel = <T,>(getter: () => T) =>
    Object.assign(
      (_id?: string) => ({
        subscribe: (fn: (v: T) => void) => {
          fn(getter());
          return () => {};
        },
      }),
      { select: (_state?: any, _id?: string) => getter() },
    );
  return {
    selectScriptById: makeSel(() => scriptState.script),
    selectScriptRuntime: makeSel(() => scriptState.runtime),
    selectScriptOutput: makeSel(() => scriptState.output),
  };
});

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: Object.assign(
    () => fontReadableRef.value,
    { select: () => fontReadableRef.value.value },
  ),
}));

vi.mock('$store/renderer/slices/scripts/scripts-slice', () => ({
  removeScript: vi.fn(),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  createAgentFromConfigRequested: vi.fn(),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: vi.fn(), state: {} },
}));

vi.mock('svelte-sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('./mocks/MockButton.svelte')).default,
}));

import ScriptOutputViewer from '../ScriptOutputViewer.svelte';

async function waitForXTermInit() {
  // The init `$effect` schedules `initXterm()` via requestAnimationFrame;
  // our mock rAF is queued as setTimeout(0). Flush timers, then microtasks.
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

describe('ScriptOutputViewer.svelte code-font wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    xtermMock.instances.length = 0;
    xtermMock.constructorOptions.length = 0;
    fontReadableRef.value = createControllableReadable(SYSTEM_DEFAULT);
    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 1 as any;
    };
    (globalThis as any).cancelAnimationFrame = vi.fn();
  });

  it('constructs the XTerm with the current code-font preference', async () => {
    render(ScriptOutputViewer, { props: { scriptId: 's-1', workspaceId: 'ws-1' } });
    await waitForXTermInit();

    expect(xtermMock.instances).toHaveLength(1);
    expect(xtermMock.constructorOptions[0]?.fontFamily).toBe(SYSTEM_DEFAULT);
  });

  it('mutates fontFamily on the same XTerm when the readable changes; no dispose, no output replay', async () => {
    render(ScriptOutputViewer, { props: { scriptId: 's-1', workspaceId: 'ws-1' } });
    await waitForXTermInit();

    expect(xtermMock.instances).toHaveLength(1);
    const xterm = xtermMock.instances[0];
    const writesBefore = xterm.write.mock.calls.length;
    expect(writesBefore).toBeGreaterThan(0); // loadBufferedOutput ran once

    fontReadableRef.value.set("'Fira Code', monospace");
    await tick();

    // Same instance, mutated in-place — no dispose / no second construction.
    expect(xtermMock.instances).toHaveLength(1);
    expect(xtermMock.instances[0]).toBe(xterm);
    expect(xterm.options.fontFamily).toBe("'Fira Code', monospace");
    expect(xterm.dispose).not.toHaveBeenCalled();

    // No output replay: font-only update MUST NOT trigger any extra writes.
    expect(xterm.write.mock.calls.length).toBe(writesBefore);
  });
});
