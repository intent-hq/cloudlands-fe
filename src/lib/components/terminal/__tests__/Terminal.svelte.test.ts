/**
 * Regression tests for `Terminal.svelte` code-font wiring (verifier follow-up).
 *
 * Exercises the real Svelte component reactive graph — mocks the terminal
 * manager, code-font selector readable, and logger — to prove:
 *
 *   1. The current code-font preference is forwarded to the mounted adapter
 *      after `terminalManager.getOrCreateTerminal` resolves (covers both new
 *      and cached/reattached adapters that may have been constructed with a
 *      stale font while detached).
 *   2. Later font-preference changes flow through the readable to the same
 *      adapter's `updateFontFamily`, without re-invoking
 *      `getOrCreateTerminal` (no adapter/PTY/XTerm recreation).
 *
 * These regressions would not be caught by adapter-only tests: removing the
 * post-`getOrCreateTerminal` apply (Terminal.svelte:138) or the live
 * `$effect` still passes every adapter unit test, but fails here.
 */
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SYSTEM_DEFAULT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

const { fontReadableRef, adapterRef, getOrCreateSpy, detachSpy } = vi.hoisted(() => ({
  fontReadableRef: { value: null as any },
  adapterRef: { value: null as any, resolve: null as null | (() => void), promise: null as any },
  getOrCreateSpy: vi.fn(),
  detachSpy: vi.fn(),
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

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: {
    getOrCreateTerminal: getOrCreateSpy,
    detachTerminal: detachSpy,
  },
}));

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: Object.assign(() => fontReadableRef.value, {
    select: () => fontReadableRef.value.value,
  }),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: vi.fn(), state: {} },
}));

vi.mock('../TerminalSearchBar.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

import Terminal from '../Terminal.svelte';

function makePendingAdapter() {
  const adapter = {
    updateFontFamily: vi.fn(),
    focus: vi.fn(),
    getSelection: vi.fn(() => ''),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearSearch: vi.fn(),
    setVisible: vi.fn(),
  };
  let resolve!: () => void;
  const promise = new Promise<typeof adapter>((res) => {
    resolve = () => res(adapter);
  });
  return { adapter, resolve, promise };
}

async function flushMicrotasks() {
  // Two ticks: one for the awaited getOrCreateTerminal, one for the trailing
  // synchronous `updateFontFamily` line after the await.
  await tick();
  await Promise.resolve();
  await tick();
}

describe('Terminal.svelte code-font wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fontReadableRef.value = createControllableReadable(SYSTEM_DEFAULT);
    const pending = makePendingAdapter();
    adapterRef.value = pending.adapter;
    (adapterRef as any).resolve = pending.resolve;
    (adapterRef as any).promise = pending.promise;
    getOrCreateSpy.mockImplementation(() => pending.promise);
  });

  afterEach(() => cleanup());

  it('forwards the current font to the adapter after getOrCreateTerminal resolves', async () => {
    render(Terminal, { props: { terminalId: 't-1', workspaceId: 'ws-1' } });

    // Sanity: getOrCreateTerminal invoked but nothing forwarded yet — the
    // adapter is still pending, so `terminal` is null when the initial $effect
    // reads the readable.
    expect(getOrCreateSpy).toHaveBeenCalledTimes(1);
    expect(adapterRef.value.updateFontFamily).not.toHaveBeenCalled();

    (adapterRef as any).resolve();
    await flushMicrotasks();

    expect(adapterRef.value.updateFontFamily).toHaveBeenCalledWith(SYSTEM_DEFAULT);
  });

  it('forwards live font-preference changes to the same adapter without recreating it', async () => {
    render(Terminal, { props: { terminalId: 't-1', workspaceId: 'ws-1' } });
    (adapterRef as any).resolve();
    await flushMicrotasks();

    const callsBefore = adapterRef.value.updateFontFamily.mock.calls.length;

    fontReadableRef.value.set("'Fira Code', monospace");
    await tick();

    // The live $effect must forward the new value to the SAME adapter that
    // was previously resolved — proving the readable→adapter reactive edge.
    expect(adapterRef.value.updateFontFamily.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(adapterRef.value.updateFontFamily).toHaveBeenLastCalledWith("'Fira Code', monospace");

    // No adapter / PTY / XTerm recreation on font change.
    expect(getOrCreateSpy).toHaveBeenCalledTimes(1);
  });

  it('parks and reveals the same adapter without detaching it', async () => {
    const { rerender } = render(Terminal, {
      props: { terminalId: 't-1', workspaceId: 'ws-1', visible: true },
    });
    (adapterRef as any).resolve();
    await flushMicrotasks();

    await rerender({ terminalId: 't-1', workspaceId: 'ws-1', visible: false });
    await tick();
    expect(adapterRef.value.setVisible).toHaveBeenLastCalledWith(false);
    expect(detachSpy).not.toHaveBeenCalled();

    await rerender({ terminalId: 't-1', workspaceId: 'ws-1', visible: true });
    await tick();
    expect(adapterRef.value.setVisible).toHaveBeenLastCalledWith(true);
    expect(getOrCreateSpy).toHaveBeenCalledTimes(1);
  });
});
