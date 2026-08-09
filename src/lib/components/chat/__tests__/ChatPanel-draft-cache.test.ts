/**
 * @vitest-environment jsdom
 *
 * Mounted tests for the per-(workspaceId, agentId) draft cache
 * (chat-draft-cache.ts) as integrated into chat-panel-draft.svelte.ts's
 * restore effect: a cache hit hydrates the composer synchronously with no
 * gate, while `drafts.get` still revalidates in the background.
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import type { DraftAttachment, DraftsClient } from '$lib/client/app-client';
import { clearDraftCacheForTests, getCachedDraft } from '../chat-draft-cache';
import ChatDraftHarness from './mocks/ChatDraftHarness.svelte';

type Draft = { text: string; attachments?: DraftAttachment[]; updatedAt: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
const AGENT_1 = 'agent-1';
const AGENT_2 = 'agent-2';

describe('ChatPanel draft cache (mounted)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearDraftCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hydrates instantly with no gate on switch-back to a previously visited pair', async () => {
    const drafts = makeDrafts((_workspaceId, agentId) =>
      Promise.resolve({ text: `draft for ${agentId}`, updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts, workspaceId: WS, agentId: AGENT_1 },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();
    expect(composer().value).toBe('draft for agent-1');

    // Visit a second pair (cache miss) so the manager's restoreKey changes.
    await rerender({ agentId: AGENT_2 });
    flushSync();
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();
    expect(composer().value).toBe('draft for agent-2');

    drafts.get.mockClear();

    // Switch back to agent-1: cache hit, instant hydration, no gate ever.
    await rerender({ agentId: AGENT_1 });
    flushSync();

    expect(composer().value).toBe('draft for agent-1');
    expect(composer().readOnly).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    // Background revalidation still happens.
    expect(drafts.get).toHaveBeenCalledExactlyOnceWith(WS, AGENT_1);
  });

  it('never shows the gate on a cache hit even if the revalidation hangs', async () => {
    const first = makeDrafts(() =>
      Promise.resolve({ text: 'cached text', updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts: first, workspaceId: WS, agentId: AGENT_1 },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    await rerender({ agentId: AGENT_2 });
    flushSync();
    await flushMicrotasks();
    flushSync();

    const hanging = new Promise<Draft | null>(() => {});
    const second = makeDrafts(() => hanging);
    await rerender({ drafts: second, agentId: AGENT_1 });
    flushSync();

    expect(composer().value).toBe('cached text');
    expect(composer().readOnly).toBe(false);

    await vi.advanceTimersByTimeAsync(5100);
    flushSync();
    expect(screen.queryByRole('status')).toBeNull();
    expect(composer().readOnly).toBe(false);
  });

  it('applies a background revalidation result that differs from the cache when the composer is untouched', async () => {
    const first = makeDrafts(() =>
      Promise.resolve({ text: 'stale cached text', updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts: first, workspaceId: WS, agentId: AGENT_1 },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    await rerender({ agentId: AGENT_2 });
    flushSync();
    await flushMicrotasks();
    flushSync();

    const revalidation = deferred<Draft | null>();
    const second = makeDrafts(() => revalidation.promise);
    await rerender({ drafts: second, agentId: AGENT_1 });
    flushSync();
    expect(composer().value).toBe('stale cached text');

    revalidation.resolve({ text: 'fresh from daemon', updatedAt: '2026-01-01T00:00:00.000Z' });
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    expect(composer().value).toBe('fresh from daemon');
  });

  it('does not overwrite user typing with a background revalidation result', async () => {
    const first = makeDrafts(() =>
      Promise.resolve({ text: 'cached text', updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts: first, workspaceId: WS, agentId: AGENT_1 },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    await rerender({ agentId: AGENT_2 });
    flushSync();
    await flushMicrotasks();
    flushSync();

    const revalidation = deferred<Draft | null>();
    const second = makeDrafts(() => revalidation.promise);
    await rerender({ drafts: second, agentId: AGENT_1 });
    flushSync();
    expect(composer().value).toBe('cached text');

    // User types before the revalidation settles.
    await typeInComposer('cached text plus my edits');

    revalidation.resolve({ text: 'fresh from daemon', updatedAt: '2026-01-01T00:00:00.000Z' });
    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    expect(composer().value).toBe('cached text plus my edits');
  });

  it('updates the cache on save so a later switch-back reflects the saved text', async () => {
    // Backend store keyed by agent, mirroring the daemon's persisted drafts —
    // `drafts.set` writes it and `drafts.get` reads it back, so the
    // background revalidation triggered by the cache-hit path reflects the
    // real save instead of racing a stale mock response.
    const backend = new Map<string, Draft | null>();
    const drafts = {
      get: vi.fn<DraftsClient['get']>((_workspaceId, agentId) =>
        Promise.resolve(backend.get(agentId) ?? null),
      ),
      set: vi.fn<DraftsClient['set']>((_workspaceId, agentId, text, attachments) => {
        backend.set(agentId, { text, attachments, updatedAt: '2026-01-01T00:00:00.000Z' });
        return Promise.resolve({ ok: true as const, updatedAt: '2026-01-01T00:00:00.000Z' });
      }),
    };
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts, workspaceId: WS, agentId: AGENT_1 },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();

    await typeInComposer('typed and saved');
    await vi.advanceTimersByTimeAsync(600);
    await flushMicrotasks();
    flushSync();
    expect(drafts.set).toHaveBeenCalledWith(WS, AGENT_1, 'typed and saved', undefined);
    expect(getCachedDraft(WS, AGENT_1)).toEqual({ text: 'typed and saved', attachments: [] });

    await rerender({ agentId: AGENT_2 });
    flushSync();
    await flushMicrotasks();
    flushSync();

    drafts.get.mockClear();
    await rerender({ agentId: AGENT_1 });
    flushSync();

    // Cache hit reflects the saved text instantly, before revalidation settles.
    expect(composer().value).toBe('typed and saved');
    expect(screen.queryByRole('status')).toBeNull();

    await flushMicrotasks();
    flushSync();
    await vi.advanceTimersByTimeAsync(60);
    flushSync();

    // Background revalidation confirms the same saved text — no clobbering.
    expect(composer().value).toBe('typed and saved');
  });

  it('caches an empty draft so switch-back to a pair with no draft is also instant', async () => {
    const drafts = makeDrafts(() => Promise.resolve(null));
    const { rerender } = render(ChatDraftHarness, {
      props: { drafts, workspaceId: WS, agentId: AGENT_1 },
    });
    flushSync();
    await flushMicrotasks();
    flushSync();
    expect(composer().value).toBe('');
    expect(screen.queryByRole('status')).toBeNull();

    await rerender({ agentId: AGENT_2 });
    flushSync();
    await flushMicrotasks();
    flushSync();

    const hanging = makeDrafts(() => new Promise<Draft | null>(() => {}));
    await rerender({ drafts: hanging, agentId: AGENT_1 });
    flushSync();

    // Cache hit on the empty draft: no gate even though this revalidation hangs.
    expect(composer().value).toBe('');
    expect(composer().readOnly).toBe(false);
    await vi.advanceTimersByTimeAsync(5100);
    flushSync();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
