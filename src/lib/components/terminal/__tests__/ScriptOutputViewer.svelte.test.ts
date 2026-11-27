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
  runtimeReadableRef,
  authorityReadableRef,
  retainedReadableRef,
  workflowOutcomeRef,
  mockGetDefinition,
} = vi.hoisted(() => ({
  xtermMock: { instances: [] as any[], constructorOptions: [] as any[] },
  fontReadableRef: { value: null as any },
  scriptState: { byWorkspaceId: {} as Record<string, Record<string, any>> },
  scriptSelectorArgs: [] as unknown[][],
  lifecycleGate: { hidesAgentLifecycleActions: false },
  outputReadableRef: { value: null as any },
  runtimeReadableRef: { value: null as any },
  authorityReadableRef: { value: null as any },
  retainedReadableRef: { value: null as any },
  workflowOutcomeRef: { value: null as any },
  mockGetDefinition: vi.fn(),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceScriptReadContext: () => authorityReadableRef.value,
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
    buffer = { active: { viewportY: 0, baseY: 0 } };
    viewportListeners: Array<() => void> = [];
    onScroll = vi.fn((fn: () => void) => this.listen(fn));
    onWriteParsed = vi.fn((fn: () => void) => this.listen(fn));
    scrollToBottom = vi.fn(() => {
      this.buffer.active.viewportY = this.buffer.active.baseY;
      this.emitViewport();
    });
    listen(fn: () => void) {
      this.viewportListeners.push(fn);
      return { dispose: vi.fn() };
    }
    emitViewport() {
      for (const fn of this.viewportListeners) fn();
    }
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
        if (getter.name === 'getRuntime' && runtimeReadableRef.value)
          return runtimeReadableRef.value;
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
    selectScriptRuntime: makeSel(function getRuntime(workspaceId: string, scriptId: string) {
      return (
        getScript(workspaceId, scriptId)?.runtime ?? {
          status: 'idle',
          pid: null,
          exitCode: null,
          restartCount: 0,
        }
      );
    }),
    selectScriptOutput: makeSel(getOutput),
    selectScriptRetainedOutput: () => retainedReadableRef.value,
    selectScriptWorkflowOutcome: () => workflowOutcomeRef.value,
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
  createScriptFixAgentRequested: (...payload: unknown[]) => ({
    type: 'scripts/createFixAgentRequested',
    payload,
  }),
  scriptWorkflowReleased: (...payload: unknown[]) => ({
    type: 'scripts/workflowReleased',
    payload,
  }),
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    state: {},
    dispatch: vi.fn((action: any) => {
      if (action.type !== 'scripts/getScriptDefinitionRequested') return action;
      const [workspaceId, scriptId, consumer] = action.payload;
      void mockGetDefinition(workspaceId, scriptId).then(
        (result: unknown) =>
          workflowOutcomeRef.value.set({
            ...consumer,
            workspaceId,
            status: 'success',
            result,
            consumed: false,
          }),
        (error: unknown) =>
          workflowOutcomeRef.value.set({
            ...consumer,
            workspaceId,
            status: 'failure',
            error: String(error),
            consumed: false,
          }),
      );
      return action;
    }),
  },
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

/** Text the terminal shows now: every write since its last reset. */
function textSinceLastReset(terminal: any): string {
  const resetAt = terminal.reset.mock.invocationCallOrder.at(-1) ?? 0;
  return terminal.write.mock.calls
    .filter((_: unknown, i: number) => terminal.write.mock.invocationCallOrder[i] > resetAt)
    .map(([text]: [string]) => text)
    .join('');
}

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
    runtimeReadableRef.value = null;
    retainedReadableRef.value = createControllableReadable(undefined);
    workflowOutcomeRef.value = createControllableReadable(undefined);
    mockGetDefinition
      .mockReset()
      .mockImplementation((workspaceId: string, scriptId: string) =>
        Promise.resolve(scriptState.byWorkspaceId[workspaceId]?.[scriptId]),
      );
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

  it('keeps the output readable but does not run while the workspace home is away', async () => {
    const { rerender } = render(ScriptOutputViewer, {
      props: { scriptId: 's-1', workspaceId: 'ws-1' },
    });
    await waitForXTermInit();
    await rerender({ scriptId: 's-1', workspaceId: 'ws-2', runDisabled: true });

    await waitFor(() => expect(screen.getByText('pnpm build')).toBeTruthy());
    const run = screen.getByRole('button', { name: /Run/ }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    await fireEvent.click(run);
    expect(appStore.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/startScriptRequested' }),
    );
  });

  it('offers "Ask AI to Fix" on a failed script when agent creation is allowed', async () => {
    render(ScriptOutputViewer, { props: { scriptId: 's-1', workspaceId: 'ws-failed' } });
    await waitForXTermInit();

    await waitFor(() => expect(screen.getByText('Ask AI to Fix')).toBeTruthy());
  });

  it('releases fix-agent preparation when the viewer changes workspace', async () => {
    const { rerender } = render(ScriptOutputViewer, {
      props: { scriptId: 's-1', workspaceId: 'ws-failed' },
    });
    await fireEvent.click(await screen.findByText('Ask AI to Fix'));
    const request = vi
      .mocked(appStore.dispatch)
      .mock.calls.map(([action]) => action)
      .find((action) => action.type === 'scripts/createFixAgentRequested');
    expect(request).toEqual({
      type: 'scripts/createFixAgentRequested',
      payload: ['ws-failed', 's-1', undefined, expect.any(String)],
    });
    await rerender({ scriptId: 's-1', workspaceId: 'ws-2' });
    expect(appStore.dispatch).toHaveBeenCalledWith({
      type: 'scripts/workflowReleased',
      payload: ['ws-failed', request.payload[3]],
    });
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
    runtimeReadableRef.value = null;
    retainedReadableRef.value = createControllableReadable(undefined);
    workflowOutcomeRef.value = createControllableReadable(undefined);
    mockGetDefinition
      .mockReset()
      .mockImplementation((workspaceId: string, scriptId: string) =>
        Promise.resolve(scriptState.byWorkspaceId[workspaceId]?.[scriptId]),
      );
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
  it('joins retained output and the live output after it in one terminal', async () => {
    const before = { text: 'before snapshot\n', timestamp: 'a' };
    const after = { text: 'after snapshot\n', timestamp: 'b' };
    outputReadableRef.value = createControllableReadable({ chunks: [before], dropped: 0 });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    expect(textSinceLastReset(terminal)).toBe('before snapshot\n');

    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[2 lines]\n\x1b[31mfirst\x1b[0m\nbefore snapshot\n',
      liveOffset: 1,
    });
    await tick();
    outputReadableRef.value.set({ chunks: [before, after], dropped: 0 });
    await tick();
    expect(textSinceLastReset(terminal)).toBe(
      '\x1b[31mfirst\x1b[0m\nbefore snapshot\nafter snapshot\n',
    );

    // A refreshed snapshot already holds every chunk it covers.
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[3 lines]\nfirst\nbefore snapshot\nafter snapshot\n',
      liveOffset: 2,
    });
    await tick();
    expect(textSinceLastReset(terminal)).toBe('first\nbefore snapshot\nafter snapshot\n');
    expect(xtermMock.instances).toHaveLength(1);
    expect(terminal.dispose).not.toHaveBeenCalled();
  });

  describe('positioned joins (scriptOutputCursor: 1)', () => {
    const utf8 = (text: string) => new TextEncoder().encode(text);
    const bytesB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const b64 = (text: string) => bytesB64(utf8(text));
    const live = (text: string, start: number, runId = 'run-1', bootId = 'boot-1') => ({
      text,
      timestamp: text,
      data: b64(text),
      position: { runId, bootId, start, end: start + utf8(text).length },
    });
    const notice = (text: string) => ({ text, timestamp: text });
    const snapshot = (
      body: string,
      end: number,
      liveOffset: number,
      { start = 0, runId = 'run-1', bootId = 'boot-1', bytes = utf8(body) } = {},
    ) => ({
      scriptId: 's-1',
      status: 'available',
      text: `[${body.split('\n').length} lines]\n${body}`,
      liveOffset,
      streamEpoch: 0,
      cursor: { runId, bootId, start, end, logStart: 0 },
      data: bytesB64(bytes),
    });
    const requests = async () => {
      const { store } = await import('$store/renderer/store');
      return (vi.mocked(store.dispatch).mock.calls as any[]).filter(
        ([a]) => a.type === 'scripts/outputRequested',
      ).length;
    };
    async function mount(chunks: unknown[]) {
      outputReadableRef.value = createControllableReadable({ chunks, dropped: 0 });
      render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
      await waitForXTermInit();
      return xtermMock.instances[0];
    }

    it('never repeats in-flight chunks the snapshot already holds, and keeps repeated lines', async () => {
      const one = live('one\n', 0);
      const two = live('two\n', 4);
      const terminal = await mount([one, two]);
      // The read began after `one`; `two` was in flight but already logged.
      retainedReadableRef.value.set(snapshot('one\ntwo\n', 8, 1));
      await tick();
      outputReadableRef.value.set({ chunks: [one, two, live('two\n', 8)], dropped: 0 });
      await tick();
      expect(textSinceLastReset(terminal)).toBe('one\ntwo\ntwo\n');
    });

    it('holds output past a gap until a fresh snapshot fills it', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('one\n', 4, 0));
      await tick();
      const resets = terminal.reset.mock.calls.length;
      const before = await requests();
      const three = live('three\n', 8);
      outputReadableRef.value.set({ chunks: [three], dropped: 0 });
      await tick();
      expect(await requests()).toBe(before + 1);
      expect(textSinceLastReset(terminal)).toBe('one\n');
      // Output after the snapshot was read follows it.
      const four = live('four\n', 14);
      outputReadableRef.value.set({ chunks: [three, four], dropped: 0 });
      await tick();
      retainedReadableRef.value.set(snapshot('one\ntwo\nthree\n', 14, 1));
      await tick();
      expect(terminal.reset.mock.calls.length).toBe(resets);
      expect(textSinceLastReset(terminal)).toBe('one\ntwo\nthree\nfour\n');
    });

    it('refreshes when a chunk comes from another daemon boot', async () => {
      await mount([]);
      retainedReadableRef.value.set(snapshot('one\n', 4, 0));
      await tick();
      const before = await requests();
      outputReadableRef.value.set({ chunks: [live('two\n', 4, 'run-1', 'boot-2')], dropped: 0 });
      await tick();
      expect(await requests()).toBe(before + 1);
    });

    it('adds only the output missed during a reconnect, without a reset', async () => {
      const two = live('two\n', 4);
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('one\n', 4, 0));
      await tick();
      outputReadableRef.value.set({ chunks: [two], dropped: 0 });
      await tick();
      const resets = terminal.reset.mock.calls.length;
      // The stream was interrupted: buffered chunks are dropped.
      outputReadableRef.value.set({ chunks: [], dropped: 1 });
      await tick();
      retainedReadableRef.value.set(snapshot('one\ntwo\nthree\n', 14, 1));
      await tick();
      expect(terminal.reset.mock.calls.length).toBe(resets);
      expect(textSinceLastReset(terminal)).toBe('one\ntwo\nthree\n');
    });

    it('confirms a new run with a snapshot and then shows only that run', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('old\n', 4, 0));
      await tick();
      const before = await requests();
      const first = live('new\n', 0, 'run-2');
      outputReadableRef.value.set({ chunks: [first], dropped: 0 });
      await tick();
      expect(await requests()).toBe(before + 1);
      expect(textSinceLastReset(terminal)).toBe('old\n');
      retainedReadableRef.value.set(snapshot('new\nmore\n', 9, 1, { runId: 'run-2' }));
      await tick();
      expect(textSinceLastReset(terminal)).toBe('new\nmore\n');
    });

    it('ignores an older run once a snapshot shows it is stale', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('b1\n', 3, 0, { runId: 'run-b' }));
      await tick();
      const before = await requests();
      const stale = live('a1\n', 0, 'run-a');
      outputReadableRef.value.set({ chunks: [stale], dropped: 0 });
      await tick();
      expect(await requests()).toBe(before + 1);
      // The fresh snapshot still names run B: run A was older.
      retainedReadableRef.value.set(snapshot('b1\n', 3, 1, { runId: 'run-b' }));
      await tick();
      outputReadableRef.value.set({
        chunks: [stale, live('a2\n', 3, 'run-a'), live('b2\n', 3, 'run-b')],
        dropped: 0,
      });
      await tick();
      expect(await requests()).toBe(before + 1);
      expect(textSinceLastReset(terminal)).toBe('b1\nb2\n');
    });

    it('leaves out an older run still buffered when a new run is snapshotted', async () => {
      const terminal = await mount([live('old\n', 0, 'run-1'), live('new\n', 0, 'run-2')]);
      retainedReadableRef.value.set(snapshot('new\n', 4, 2, { runId: 'run-2' }));
      await tick();
      expect(textSinceLastReset(terminal)).toBe('new\n');
    });

    it('keeps buffered output older than a capped first snapshot', async () => {
      const lines = [live('line 1\n', 0), live('line 2\n', 7), live('line 3\n', 14)];
      const terminal = await mount(lines);
      retainedReadableRef.value.set(snapshot('line 2\nline 3\n', 21, 3, { start: 7 }));
      await tick();
      expect(textSinceLastReset(terminal)).toBe('line 1\nline 2\nline 3\n');
    });

    it('completes a character split across a snapshot and its refresh', async () => {
      const head = Uint8Array.of(0x41, 0xe2);
      const whole = Uint8Array.of(0x41, 0xe2, 0x82, 0xac, 0x42);
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('A', 2, 0, { bytes: head }));
      await tick();
      retainedReadableRef.value.set(snapshot('A€B', 5, 0, { bytes: whole }));
      await tick();
      expect(textSinceLastReset(terminal)).toBe('A€B');
    });

    it('completes a character split across a snapshot and the next live chunk', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('A', 2, 0, { bytes: Uint8Array.of(0x41, 0xe2) }));
      await tick();
      const tail = Uint8Array.of(0x82, 0xac, 0x42);
      outputReadableRef.value.set({
        chunks: [
          {
            text: '\ufffdB',
            timestamp: 't',
            data: bytesB64(tail),
            position: { runId: 'run-1', bootId: 'boot-1', start: 2, end: 5 },
          },
        ],
        dropped: 0,
      });
      await tick();
      expect(textSinceLastReset(terminal)).toBe('A€B');
    });

    it('keeps streaming when the refresh for a first run comes back empty', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set({
        scriptId: 's-1',
        status: 'unavailable',
        liveOffset: 0,
        cursor: { runId: null, bootId: 'boot-1', start: 0, end: 0, logStart: 0 },
      });
      await tick();
      const blank = live('\n', 0, 'run-2');
      outputReadableRef.value.set({ chunks: [blank], dropped: 0 });
      await tick();
      // The refresh was read before the run logged anything.
      retainedReadableRef.value.set({
        scriptId: 's-1',
        status: 'unavailable',
        liveOffset: 1,
        cursor: { runId: 'run-2', bootId: 'boot-1', start: 0, end: 0, logStart: 0 },
      });
      await tick();
      outputReadableRef.value.set({ chunks: [blank, live('next\n', 1, 'run-2')], dropped: 0 });
      await tick();
      expect(textSinceLastReset(terminal)).toBe('\nnext\n');
    });

    it('accepts a gap a fresh snapshot cannot fill instead of refreshing again', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('one\n', 4, 0));
      await tick();
      const before = await requests();
      const late = live('later\n', 10);
      outputReadableRef.value.set({ chunks: [late], dropped: 0 });
      await tick();
      retainedReadableRef.value.set(snapshot('one\n', 4, 1));
      await tick();
      expect(await requests()).toBe(before + 1);
      expect(textSinceLastReset(terminal)).toBe('one\nlater\n');
    });

    it('shows output of the joined run that arrives while another run is unconfirmed', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('one\n', 4, 0));
      await tick();
      const other = live('elsewhere\n', 0, 'run-1', 'boot-2');
      outputReadableRef.value.set({ chunks: [other, live('two\n', 4)], dropped: 0 });
      await tick();
      retainedReadableRef.value.set(snapshot('one\n', 4, 1));
      await tick();
      expect(textSinceLastReset(terminal)).toBe('one\ntwo\n');
    });

    it('keeps the screen and lets held output through when a refresh fails', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set(snapshot('one\n', 4, 0));
      await tick();
      const resets = terminal.reset.mock.calls.length;
      outputReadableRef.value.set({ chunks: [live('three\n', 8)], dropped: 0 });
      await tick();
      retainedReadableRef.value.set({ scriptId: 's-1', status: 'unavailable' });
      await tick();
      expect(terminal.reset.mock.calls.length).toBe(resets);
      expect(textSinceLastReset(terminal)).toBe('one\nthree\n');
    });

    it('completes a character when the first snapshot holds only its first byte', async () => {
      const terminal = await mount([]);
      retainedReadableRef.value.set({
        scriptId: 's-1',
        status: 'unavailable',
        liveOffset: 0,
        cursor: { runId: 'run-1', bootId: 'boot-1', start: 0, end: 1, logStart: 0 },
        data: bytesB64(Uint8Array.of(0xe2)),
      });
      await tick();
      outputReadableRef.value.set({
        chunks: [
          {
            text: '\ufffd',
            timestamp: 't',
            data: bytesB64(Uint8Array.of(0x82, 0xac)),
            position: { runId: 'run-1', bootId: 'boot-1', start: 1, end: 3 },
          },
        ],
        dropped: 0,
      });
      await tick();
      expect(textSinceLastReset(terminal)).toBe('€');
    });

    it('writes daemon notices that arrive after the read but not those before it', async () => {
      const early = notice('--- Restarting ---\r\n');
      const terminal = await mount([early]);
      retainedReadableRef.value.set(snapshot('one\n', 4, 1));
      await tick();
      outputReadableRef.value.set({
        chunks: [early, notice('--- Exited too quickly ---\r\n')],
        dropped: 0,
      });
      await tick();
      expect(textSinceLastReset(terminal)).toBe('one\n--- Exited too quickly ---\r\n');
    });
  });

  it('keeps live bytes the daemon no longer has when its first answer has no output', async () => {
    outputReadableRef.value = createControllableReadable({
      chunks: [{ text: 'live bytes', timestamp: 'now' }],
      dropped: 0,
    });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({ scriptId: 's-1', status: 'unavailable', liveOffset: 1 });
    await tick();
    retainedReadableRef.value.set({ scriptId: 's-1', status: 'unavailable' });
    await tick();
    expect(textSinceLastReset(terminal)).toBe('live bytes');
  });

  it('clears a shown run when the next run has no output yet', async () => {
    const old = { text: 'old live\n', timestamp: 'a' };
    outputReadableRef.value = createControllableReadable({ chunks: [old], dropped: 0 });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[1 lines]\nold run\n',
      liveOffset: 1,
    });
    await tick();
    retainedReadableRef.value.set({ scriptId: 's-1', status: 'unavailable', liveOffset: 1 });
    await tick();
    outputReadableRef.value.set({
      chunks: [old, { text: 'new run\n', timestamp: 'b' }],
      dropped: 0,
    });
    await tick();
    expect(textSinceLastReset(terminal)).toBe('new run\n');
  });

  it('keeps richer same-run history when a capped refresh arrives', async () => {
    const chunk = (text: string) => ({ text, timestamp: text });
    runtimeReadableRef.value = createControllableReadable<any>({
      status: 'running',
      startedAt: 't1',
      restartCount: 0,
    });
    outputReadableRef.value = createControllableReadable({
      chunks: [chunk('line 1\n'), chunk('line 2\n')],
      dropped: 0,
    });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[2 lines]\nline 1\nline 2\n',
      liveOffset: 2,
      streamEpoch: 0,
    });
    await tick();
    outputReadableRef.value.set({
      chunks: [chunk('line 1\n'), chunk('line 2\n'), chunk('line 3\n')],
      dropped: 0,
    });
    await tick();
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[showing last 1 of 3 lines; older output omitted to fit the reply size limit]\nline 3\n',
      liveOffset: 3,
      streamEpoch: 0,
    });
    await tick();
    expect(textSinceLastReset(terminal)).toBe('line 1\nline 2\nline 3\n');

    runtimeReadableRef.value.set({ status: 'running', startedAt: 't2', restartCount: 0 });
    await tick();
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[showing last 1 of 9 lines]\nnext run\n',
      liveOffset: 3,
    });
    await tick();
    expect(textSinceLastReset(terminal)).toBe(
      '\x1b[2m[showing last 1 of 9 lines]\x1b[22m\nnext run\n',
    );
  });

  it('takes a capped same-run snapshot that may hold output the stream missed', async () => {
    runtimeReadableRef.value = createControllableReadable<any>({
      status: 'running',
      startedAt: 't1',
      restartCount: 0,
    });
    outputReadableRef.value = createControllableReadable({ chunks: [], dropped: 0 });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    const capped = (body: string) =>
      `[showing last 1 of 9 lines; older output omitted to fit the reply size limit]\n${body}`;
    // A fallback read from before the stream was routable, then its recovery read.
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: capped('fallback\n'),
      liveOffset: 0,
    });
    await tick();
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: capped('recovered gap\n'),
      liveOffset: 0,
      streamEpoch: 0,
    });
    await tick();
    expect(textSinceLastReset(terminal)).toContain('recovered gap\n');
    // A read after a stream interruption may hold output that was never streamed.
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: capped('after reconnect\n'),
      liveOffset: 0,
      streamEpoch: 1,
    });
    await tick();
    expect(textSinceLastReset(terminal)).toContain('after reconnect\n');
  });

  it('keeps a fuller live buffer when the first snapshot is capped', async () => {
    const chunk = (text: string) => ({ text, timestamp: text });
    const buffered = [chunk('line 1\n'), chunk('line 2\n'), chunk('line 3\n')];
    outputReadableRef.value = createControllableReadable({ chunks: buffered, dropped: 0 });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[showing last 2 of 3 lines; older output omitted to fit the reply size limit]\nline 2\nline 3\n',
      liveOffset: 3,
      streamEpoch: 0,
    });
    await tick();
    outputReadableRef.value.set({ chunks: [...buffered, chunk('line 4\n')], dropped: 0 });
    await tick();
    expect(textSinceLastReset(terminal)).toBe('line 1\nline 2\nline 3\nline 4\n');
  });

  it('keeps snapshot-only output after a repeated line that live output also holds', async () => {
    outputReadableRef.value = createControllableReadable({
      chunks: [{ text: 'heartbeat\n', timestamp: 'late' }],
      dropped: 0,
    });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[showing last 3 of 9 lines]\nheartbeat\ndiagnostic\nheartbeat\n',
      liveOffset: 1,
      streamEpoch: 0,
    });
    await tick();
    expect(textSinceLastReset(terminal)).toContain('diagnostic\n');
  });

  it('keeps buffered history before a long run of repeated lines', async () => {
    const chunks = [
      { text: 'diagnostic\n', timestamp: 'a' },
      { text: 'heartbeat\n'.repeat(3000), timestamp: 'b' },
      { text: 'done\n', timestamp: 'c' },
    ];
    outputReadableRef.value = createControllableReadable({ chunks, dropped: 0 });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: `[showing last 2501 of 3002 lines]\n${'heartbeat\n'.repeat(2500)}done\n`,
      liveOffset: 3,
      streamEpoch: 0,
    });
    await tick();
    expect(textSinceLastReset(terminal).startsWith('diagnostic\n')).toBe(true);
  });

  it('requests a new snapshot only when a new run starts', async () => {
    const { store } = await import('$store/renderer/store');
    runtimeReadableRef.value = createControllableReadable<any>({
      status: 'running',
      startedAt: 't1',
      restartCount: 0,
    });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await tick();
    const requests = () =>
      (vi.mocked(store.dispatch).mock.calls as any[]).filter(
        ([a]) => a.type === 'scripts/outputRequested',
      ).length;
    expect(requests()).toBe(1);
    for (const runtime of [
      { status: 'running', startedAt: 't1', detectedUrl: 'http://localhost:5173' },
      { status: 'running', startedAt: 't1', readiness: 'ready' },
      { status: 'exited', startedAt: 't1', exitCode: 0 },
    ]) {
      runtimeReadableRef.value.set({ restartCount: 0, ...runtime });
      await tick();
    }
    expect(requests()).toBe(1);
    runtimeReadableRef.value.set({ status: 'starting', restartCount: 0 });
    await tick();
    runtimeReadableRef.value.set({ status: 'running', startedAt: 't2', restartCount: 0 });
    await tick();
    expect(requests()).toBe(3);
  });

  it('keeps a shown snapshot on screen while a re-request loads', async () => {
    scriptState.byWorkspaceId['ws-failed']['s-1'].runtime = { status: 'idle' };
    const snapshot = {
      scriptId: 's-1',
      status: 'available',
      text: '[1 lines]\nprevious run\n',
      liveOffset: 0,
    };
    retainedReadableRef.value.set(snapshot);
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    retainedReadableRef.value.set({ scriptId: 's-1', status: 'loading' });
    await tick();
    retainedReadableRef.value.set({ ...snapshot });
    await tick();
    await waitForXTermInit();
    expect(xtermMock.instances).toHaveLength(1);
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(textSinceLastReset(terminal)).toBe('previous run\n');
  });

  it('shows retained output of an idle script instead of the run prompt', async () => {
    scriptState.byWorkspaceId['ws-failed']['s-1'].runtime = { status: 'idle' };
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await tick();
    expect(screen.queryByRole('button', { name: /run/i })).toBeTruthy();

    retainedReadableRef.value.set({ scriptId: 's-1', status: 'loading' });
    await tick();
    expect(screen.queryByRole('button', { name: /run/i })).toBeNull();

    retainedReadableRef.value.set({
      scriptId: 's-1',
      status: 'available',
      text: '[1 lines]\nprevious run\n',
      liveOffset: 0,
    });
    await tick();
    await waitForXTermInit();
    expect(screen.queryByRole('button', { name: /run/i })).toBeNull();
    expect(textSinceLastReset(xtermMock.instances[0])).toBe('previous run\n');

    retainedReadableRef.value.set({ scriptId: 's-1', status: 'unavailable' });
    await tick();
    expect(screen.queryByRole('button', { name: /run/i })).toBeTruthy();
  });

  it('offers a jump to the end only while scrolled away from it', async () => {
    outputReadableRef.value = createControllableReadable({
      chunks: [{ text: 'line\n', timestamp: 'now' }],
      dropped: 0,
    });
    render(ScriptOutputViewer, { props: { workspaceId: 'ws-failed', scriptId: 's-1' } });
    await waitForXTermInit();
    const terminal = xtermMock.instances[0];
    const jump = () => screen.queryByTestId('chat-floating-scroll-to-bottom-button');

    terminal.buffer.active = { viewportY: 40, baseY: 40 };
    terminal.emitViewport();
    await tick();
    expect(jump()).toBeNull();

    terminal.buffer.active.viewportY = 12;
    terminal.emitViewport();
    await tick();
    expect(jump()).toBeTruthy();

    await fireEvent.click(jump()!);
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(jump()).toBeNull();
  });
});
