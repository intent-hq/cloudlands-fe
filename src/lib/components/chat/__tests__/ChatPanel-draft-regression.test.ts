/**
 * @vitest-environment jsdom
 *
 * Mounted regressions for the ChatPanel composer draft restore/save lifecycle
 * (chat-panel-draft.svelte.ts + ChatDraftLoadingGate), reproducing the draft
 * erasure defects: a stale hydration callback clobbering active typing, and
 * the mount-time empty save racing the in-flight restore.
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import type { DraftAttachment, DraftsClient } from '$lib/client/app-client';
import ChatDraftHarness from './mocks/ChatDraftHarness.svelte';

type Draft = { text: string; attachments?: DraftAttachment[]; updatedAt: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDrafts(getImpl?: (workspaceId: string, agentId: string) => Promise<Draft | null>) {
  return {
    get: vi.fn<DraftsClient['get']>(getImpl ?? (() => Promise.resolve(null))),
    set: vi.fn<DraftsClient['set']>(() =>
      Promise.resolve({ ok: true as const, updatedAt: '2026-01-01T00:00:00.000Z' }),
    ),
  };
}

/** Flush microtasks (promise continuations) under fake timers. */
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function composer(): HTMLTextAreaElement {
  return screen.getByTestId('mock-composer') as HTMLTextAreaElement;
}

async function typeInComposer(text: string) {
  const el = composer();
  el.value = text;
  await fireEvent.input(el);
  flushSync();
}

const WS = 'ws-1';
const AGENT = 'agent-1';

describe('ChatPanel draft restore/save (mounted)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the loading gate and disables the composer while drafts.get is in flight', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();

    expect(drafts.get).toHaveBeenCalledExactlyOnceWith(WS, AGENT);
    expect(screen.getByRole('status').textContent).toContain('Loading draft message');
    expect(composer().disabled).toBe(true);
  });

  it('restores draft text and attachments, then releases the gate', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();

    pending.resolve({
      text: 'saved draft',
      attachments: [
        { id: 'a1', type: 'file', label: 'shot.png', imageData: 'AAA', imageMimeType: 'image/png' },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    expect(composer().value).toBe('saved draft');
    expect(screen.getByTestId('context-count').textContent).toBe('1');
    expect(screen.queryByRole('status')).toBeNull();
    expect(composer().disabled).toBe(false);
  });

  it('releases the gate when drafts.get rejects', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();
    expect(screen.getByRole('status')).toBeTruthy();

    pending.reject(new Error('daemon unavailable'));
    await flushMicrotasks();
    flushSync();

    expect(screen.queryByRole('status')).toBeNull();
    expect(composer().disabled).toBe(false);
  });

  it('force-releases the gate after the 5s fallback if drafts.get hangs', async () => {
    const drafts = makeDrafts(() => new Promise<Draft | null>(() => {}));
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();
    expect(screen.getByRole('status')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5100);
    flushSync();

    expect(screen.queryByRole('status')).toBeNull();
    expect(composer().disabled).toBe(false);
  });

  // REGRESSION (defect 1): the deferred editor-hydration callback fired ~50ms
  // after restore and clobbered whatever the user typed inside that window.
  it('does not erase text the user typed during the hydration window (stale hydration)', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();

    pending.resolve({ text: 'saved draft', updatedAt: '2026-01-01T00:00:00.000Z' });
    await flushMicrotasks();
    flushSync();

    // User edits inside the ~50ms window before the editor hydration fires.
    await typeInComposer('saved draft plus my edits');

    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    expect(composer().value).toBe('saved draft plus my edits');
  });

  it('does not restore over text the user typed before the draft resolved', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();

    await vi.advanceTimersByTimeAsync(5100);
    flushSync();
    expect(composer().disabled).toBe(false);

    await typeInComposer('user typed this');

    pending.resolve({
      text: 'saved draft',
      attachments: [
        { id: 'a1', type: 'file', label: 'shot.png', imageData: 'AAA', imageMimeType: 'image/png' },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    expect(composer().value).toBe('user typed this');
    // Attachments are typing-authoritative too: the late restore must not
    // inject the old draft's attachments next to the freshly typed text.
    expect(screen.getByTestId('context-count').textContent).toBe('0');
  });

  // REGRESSION: a restore resolving after a completed save must not clobber
  // lastPersisted — otherwise a later edit back to the old draft text is
  // suppressed as a no-op and the daemon copy silently diverges.
  it('keeps dirty-tracking from a completed save when the restore resolves late', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();

    await vi.advanceTimersByTimeAsync(5100);
    flushSync();

    await typeInComposer('hello');
    await vi.advanceTimersByTimeAsync(600);
    await flushMicrotasks();
    expect(drafts.set).toHaveBeenCalledWith(WS, AGENT, 'hello', undefined);

    pending.resolve({ text: 'saved', updatedAt: '2026-01-01T00:00:00.000Z' });
    await flushMicrotasks();
    flushSync();

    drafts.set.mockClear();
    await typeInComposer('saved');
    await vi.advanceTimersByTimeAsync(600);
    await flushMicrotasks();

    expect(drafts.set).toHaveBeenCalledWith(WS, AGENT, 'saved', undefined);
  });

  it('re-runs the restore when the (workspaceId, agentId) pair changes', async () => {
    const drafts = makeDrafts((workspaceId, agentId) =>
      Promise.resolve({
        text: `draft for ${agentId}`,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts, workspaceId: WS, agentId: AGENT },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();
    expect(composer().value).toBe('draft for agent-1');

    await rerender({ agentId: 'agent-2' });
    flushSync();
    expect(drafts.get).toHaveBeenLastCalledWith(WS, 'agent-2');
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();
    expect(composer().value).toBe('draft for agent-2');
  });

  it('flushes the pending debounced save at unmount instead of dropping or leaking it', async () => {
    const drafts = makeDrafts(() => Promise.resolve(null));
    const { unmount } = render(ChatDraftHarness, {
      props: { drafts, workspaceId: WS, agentId: AGENT },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();

    await typeInComposer('about to unmount');
    unmount();

    // The flush fires synchronously at teardown — not later via a leaked timer.
    expect(drafts.set).toHaveBeenCalledExactlyOnceWith(WS, AGENT, 'about to unmount', undefined);
    await vi.advanceTimersByTimeAsync(600);
    await flushMicrotasks();
    expect(drafts.set).toHaveBeenCalledTimes(1);
  });

  // REGRESSION (defect 2): the debounced save effect ran on mount with the
  // still-empty composer and persisted "" over the saved draft before
  // drafts.get resolved.
  it('does not fire an empty drafts.set while the restore is still in flight', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(600);
    expect(drafts.set).not.toHaveBeenCalled();

    pending.resolve({ text: 'saved draft', updatedAt: '2026-01-01T00:00:00.000Z' });
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();
    expect(composer().value).toBe('saved draft');
  });

  it('persists the typed draft with exact wire params after restore settles', async () => {
    const drafts = makeDrafts(() => Promise.resolve(null));
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();

    await typeInComposer('hello daemon');
    await vi.advanceTimersByTimeAsync(600);

    expect(drafts.set).toHaveBeenCalledWith(WS, AGENT, 'hello daemon', undefined);
    const emptySaves = drafts.set.mock.calls.filter(([, , text]) => text === '');
    expect(emptySaves).toHaveLength(0);
  });

  it('reports save failures through onSaveError', async () => {
    const drafts = makeDrafts(() => Promise.resolve(null));
    const failure = new Error('disk full');
    drafts.set.mockRejectedValue(failure);
    const onSaveError = vi.fn();
    render(ChatDraftHarness, {
      props: { drafts, workspaceId: WS, agentId: AGENT, onSaveError },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();

    await typeInComposer('will fail');
    await vi.advanceTimersByTimeAsync(600);
    await flushMicrotasks();

    expect(onSaveError).toHaveBeenCalledWith(failure);
  });

  // REGRESSION: conditionally unmounting/remounting the composer (e.g. the
  // question wizard replacing it) must not drop the draft, re-arm the gate,
  // or fire an empty save.
  it('preserves the draft across a composer unmount/remount without re-gating or empty saves', async () => {
    const drafts = makeDrafts(() =>
      Promise.resolve({ text: 'saved draft', updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts, workspaceId: WS, agentId: AGENT },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();
    expect(composer().value).toBe('saved draft');
    await vi.advanceTimersByTimeAsync(600);
    drafts.set.mockClear();

    await rerender({ showComposer: false });
    flushSync();
    expect(screen.queryByTestId('mock-composer')).toBeNull();

    await rerender({ showComposer: true });
    flushSync();
    await vi.advanceTimersByTimeAsync(600);
    flushSync();

    expect(composer().value).toBe('saved draft');
    expect(screen.queryByRole('status')).toBeNull();
    expect(drafts.get).toHaveBeenCalledTimes(1);
    const emptySaves = drafts.set.mock.calls.filter(([, , text]) => text === '');
    expect(emptySaves).toHaveLength(0);
  });

  // Positive counterpart to the typed-text guard: a draft resolving after the
  // 5s gate release still restores when the composer remained empty.
  it('applies a late-resolving draft after the gate timeout when the composer is still empty', async () => {
    const pending = deferred<Draft | null>();
    const drafts = makeDrafts(() => pending.promise);
    render(ChatDraftHarness, { props: { drafts, workspaceId: WS, agentId: AGENT } });
    flushSync();
    await flushMicrotasks();
    flushSync();

    await vi.advanceTimersByTimeAsync(5100);
    flushSync();
    expect(screen.queryByRole('status')).toBeNull();
    expect(composer().disabled).toBe(false);

    pending.resolve({ text: 'saved draft', updatedAt: '2026-01-01T00:00:00.000Z' });
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    expect(composer().value).toBe('saved draft');
  });

  it('does not gate or restore when workspace/agent ids are missing', async () => {
    const drafts = makeDrafts();
    render(ChatDraftHarness, { props: { drafts } });
    flushSync();
    await flushMicrotasks();
    flushSync();

    expect(drafts.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(composer().disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(drafts.set).not.toHaveBeenCalled();
  });
});
