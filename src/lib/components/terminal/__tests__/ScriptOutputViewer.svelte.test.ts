import { store as appStore } from '$store/renderer/store';
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
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SYSTEM_DEFAULT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

const {
  xtermMock,
  fontReadableRef,
  scriptState,
  scriptSelectorArgs,
  lifecycleGate,
  outputReadableRef,
  authorityReadableRef,
  retainedReadableRef,
} = vi.hoisted(() => ({
  xtermMock: { instances: [] as any[], constructorOptions: [] as any[] },
  fontReadableRef: { value: null as any },
  scriptState: { byWorkspaceId: {} as Record<string, Record<string, any>> },
  scriptSelectorArgs: [] as unknown[][],
  lifecycleGate: { hidesAgentLifecycleActions: false },
  outputReadableRef: { value: null as any },
  authorityReadableRef: { value: null as any },
  retainedReadableRef: { value: null as any },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActionContext: () => authorityReadableRef.value,
  selectHidesAgentLifecycleActions: () => ({
    subscribe: (fn: (v: boolean) => void) => {
      fn(lifecycleGate.hidesAgentLifecycleActions);
      return () => {};
    },
  }),
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
    reset = vi.fn();
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

vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => {
  const makeSel = <T>(getter: (workspaceId: string, scriptId: string) => T) =>
    Object.assign(
      (workspaceArg: any, scriptArg: any) => {
        scriptSelectorArgs.push([workspaceArg, scriptArg]);
        if (getter.name === 'getOutput' && outputReadableRef.value) return outputReadableRef.value;
        return {
          subscribe: (fn: (v: T) => void) => {
            let workspaceId: string | undefined;
            let scriptId: string | undefined;
            const emit = () => {
              if (workspaceId !== undefined && scriptId !== undefined) {
                fn(getter(workspaceId, scriptId));
              }
            };
            const unsubscribeWorkspace = workspaceArg.subscribe((value: string) => {
              workspaceId = value;
              emit();
            });
            const unsubscribeScript = scriptArg.subscribe((value: string) => {
              scriptId = value;
              emit();
            });
            return () => {
              unsubscribeWorkspace();
              unsubscribeScript();
            };
          },
        };
      },
      {
        select: (_state: any, workspaceId: string, scriptId: string) =>
          getter(workspaceId, scriptId),
      },
    );
  const getScript = (workspaceId: string, scriptId: string) =>
    scriptState.byWorkspaceId[workspaceId]?.[scriptId] ?? null;
  function getOutput(workspaceId: string, scriptId: string) {
    return (
      outputReadableRef.value?.value ??
      getScript(workspaceId, scriptId)?.output ?? { chunks: [], dropped: 0 }
    );
  }
  return {
    selectScriptById: makeSel(getScript),
    selectScriptRuntime: makeSel(
      (workspaceId, scriptId) =>
        getScript(workspaceId, scriptId)?.runtime ?? {
          status: 'idle',
          pid: null,
          exitCode: null,
          restartCount: 0,
        },
    ),
    selectScriptOutput: makeSel(getOutput),
    selectScriptRetainedOutput: () => retainedReadableRef.value,
  };
});

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: Object.assign(() => fontReadableRef.value, {
    select: () => fontReadableRef.value.value,
  }),
}));

vi.mock('$store/renderer/slices/scripts/scripts-slice', () => ({
  startScriptRequested: (...payload: unknown[]) => ({
    type: 'scripts/startScriptRequested',
    payload,
  }),
  scriptOutputRequested: (...payload: unknown[]) => ({ type: 'scripts/outputRequested', payload }),
  scriptOutputReleased: (...payload: unknown[]) => ({ type: 'scripts/outputReleased', payload }),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  createAgentFromConfigRequested: vi.fn(),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: vi.fn(), state: {} },
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
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
    scriptSelectorArgs.length = 0;
    lifecycleGate.hidesAgentLifecycleActions = false;
    outputReadableRef.value = null;
    retainedReadableRef.value = createControllableReadable(undefined);
    authorityReadableRef.value = createControllableReadable<string | null>('authority');
    scriptState.byWorkspaceId = {
      'ws-failed': {
        's-1': {
          id: 's-1',
          workspaceId: 'ws-failed',
          name: 'build',
          command: 'pnpm build',
          mode: 'command',
          source: 'user',
          createdAt: '2026-01-02T00:00:00.000Z',
          runtime: { status: 'exited', pid: null, exitCode: 1, restartCount: 0 },
          output: {
            chunks: [{ text: 'boom\n', timestamp: '2026-01-02T00:00:00.000Z' }],
            dropped: 0,
          },
        },
      },
      'ws-1': {
        's-1': {
          id: 's-1',
          workspaceId: 'ws-1',
          name: 'dev',
          command: 'pnpm dev',
          mode: 'service',
          source: 'user',
          createdAt: '2026-01-01T00:00:00.000Z',
          runtime: { status: 'running', pid: 123, exitCode: null, restartCount: 0 },
          output: {
            chunks: [{ text: 'hello\n', timestamp: '2026-01-01T00:00:00.000Z' }],
            dropped: 0,
          },
        },
      },
      'ws-2': {
        's-1': {
          id: 's-1',
          workspaceId: 'ws-2',
          name: 'build',
          command: 'pnpm build',
          mode: 'command',
          source: 'user',
          createdAt: '2026-01-02T00:00:00.000Z',
          runtime: { status: 'idle', pid: null, exitCode: null, restartCount: 0 },
          output: { chunks: [], dropped: 0 },
        },
      },
    };
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

  it('renders and starts the script from the rerendered workspace', async () => {
    const { rerender } = render(ScriptOutputViewer, {
      props: { scriptId: 's-1', workspaceId: 'ws-1' },
    });
    await waitForXTermInit();

    await rerender({ scriptId: 's-1', workspaceId: 'ws-2' });

    await waitFor(() => expect(screen.getByText('pnpm build')).toBeTruthy());
    expect(screen.queryByText('pnpm dev')).toBeNull();
    expect(scriptSelectorArgs).toHaveLength(3);
    expect(
      scriptSelectorArgs.every(
        ([workspaceArg, scriptArg]: any[]) =>
          typeof workspaceArg?.subscribe === 'function' &&
          typeof scriptArg?.subscribe === 'function',
      ),
    ).toBe(true);

    await fireEvent.click(screen.getByText('Run'));
    expect(appStore.dispatch).toHaveBeenCalledWith({
      type: 'scripts/startScriptRequested',
      payload: ['ws-2', 's-1'],
    });
  });

  it('offers "Ask AI to Fix" on a failed script when agent creation is allowed', async () => {
    render(ScriptOutputViewer, { props: { scriptId: 's-1', workspaceId: 'ws-failed' } });
    await waitForXTermInit();

    await waitFor(() => expect(screen.getByText('Ask AI to Fix')).toBeTruthy());
  });

  it('withholds "Ask AI to Fix" when agent lifecycle actions are hidden', async () => {
    lifecycleGate.hidesAgentLifecycleActions = true;
    render(ScriptOutputViewer, { props: { scriptId: 's-1', workspaceId: 'ws-failed' } });
    await waitForXTermInit();

    await waitFor(() => expect(screen.getByText(/exit code 1/)).toBeTruthy());
    expect(screen.queryByText('Ask AI to Fix')).toBeNull();
  });
});

describe('retained output viewer lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    xtermMock.instances.length = 0;
    xtermMock.constructorOptions.length = 0;
    scriptSelectorArgs.length = 0;
    outputReadableRef.value = null;
    retainedReadableRef.value = createControllableReadable(undefined);
    authorityReadableRef.value = createControllableReadable<string | null>('authority');
    fontReadableRef.value = createControllableReadable(SYSTEM_DEFAULT);
    scriptState.byWorkspaceId = {
      'ws-failed': {
        's-1': {
          id: 's-1',
          name: 'Failed',
          command: 'false',
          runtime: { status: 'exited', exitCode: 1 },
          output: { chunks: [], dropped: 0 },
        },
      },
    };
    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    };
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 1;
    };
    (globalThis as any).cancelAnimationFrame = vi.fn();
  });
  it('requests retained output only when admitted, retries after reconnect, and releases on unmount', async () => {
    const { store } = await import('$store/renderer/store');
    authorityReadableRef.value = createControllableReadable<string | null>(null);
    const view = render(ScriptOutputViewer, {
      props: { workspaceId: 'ws-failed', scriptId: 's-1' },
    });
    await tick();
    expect(store.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/outputRequested' }),
    );
    authorityReadableRef.value.set('admitted-1');
    await tick();
    const first = (vi.mocked(store.dispatch).mock.calls as any[]).find(
      ([a]) => a.type === 'scripts/outputRequested',
    )[0];
    expect(first.payload.slice(0, 2)).toEqual(['ws-failed', 's-1']);
    authorityReadableRef.value.set(null);
    await tick();
    expect(store.dispatch).toHaveBeenCalledWith({
      type: 'scripts/outputReleased',
      payload: first.payload,
    });
    authorityReadableRef.value.set('admitted-2');
    await tick();
    const requests = (vi.mocked(store.dispatch).mock.calls as any[]).filter(
      ([a]) => a.type === 'scripts/outputRequested',
    );
    expect(requests).toHaveLength(2);
    await view.unmount();
    expect(store.dispatch).toHaveBeenCalledWith({
      type: 'scripts/outputReleased',
      payload: requests[1][0].payload,
    });
  });
  it('shows available history directly without writing it into the mounted live terminal', async () => {
    outputReadableRef.value = createControllableReadable({ chunks: [], dropped: 0 });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[2 lines]\nretained-failure\n',
    });
    await tick();
    expect(screen.getByText(/retained-failure/)).toBeTruthy();
    expect(screen.getByText('Retained output').closest('details')?.open).toBe(true);
    expect(terminal.write).not.toHaveBeenCalledWith(expect.stringContaining('retained-failure'));
    outputReadableRef.value.set({
      chunks: [{ text: 'retained-failure\n', timestamp: 'late' }],
      dropped: 0,
    });
    await tick();
    expect(terminal.write.mock.calls).toEqual([['retained-failure\n']]);
    expect(screen.getByText('Live output')).toBeTruthy();
    expect(xtermMock.instances).toHaveLength(1);
    expect(terminal.reset).not.toHaveBeenCalled();
    expect(terminal.dispose).not.toHaveBeenCalled();
  });
  it('keeps a richer mounted terminal visible while the separate snapshot is collapsed', async () => {
    outputReadableRef.value = createControllableReadable({
      chunks: [{ text: 'richer live bytes', timestamp: 'now' }],
      dropped: 0,
    });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[1 lines]\ntail',
    });
    await tick();
    expect(screen.getByText('Retained output').closest('details')?.open).toBe(false);
    expect(terminal.write.mock.calls).toEqual([['richer live bytes']]);
    expect(terminal.reset).not.toHaveBeenCalled();
    expect(terminal.dispose).not.toHaveBeenCalled();
  });
  it('distinguishes retained output loading and unavailability', async () => {
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    retainedReadableRef.value.set({ scriptId: 's-1', status: 'loading' });
    await tick();
    expect(screen.getByRole('status').textContent).toBe('Loading retained output…');
    retainedReadableRef.value.set({ scriptId: 's-1', status: 'unavailable' });
    await tick();
    expect(screen.getByRole('status').textContent).toBe('Retained output is unavailable.');
  });
});
