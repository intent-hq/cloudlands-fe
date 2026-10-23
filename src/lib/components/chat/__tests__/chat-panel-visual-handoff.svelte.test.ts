import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatDraftManager, type ChatDraftManager } from '../chat-panel-draft.svelte';
import { clearDraftCacheForTests } from '../chat-draft-cache';
import { createChatDraftStoreDriver } from './mocks/chat-draft-store-driver';
import type { DraftsClient } from '$lib/client/app-client';
import type { ContextItem } from '../input/context-api';
import { appendInlineVisualDraft } from '$features/inline-html/inline-visual-handoff';

type Draft = Awaited<ReturnType<DraftsClient['get']>>;
const disposers: (() => void)[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
  clearDraftCacheForTests();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

describe('visual handoff draft-restore boundary', () => {
  it('waits past the typing-lock timeout and preserves restored text and attachments before appending', async () => {
    const pending = deferred<Draft>();
    const drafts = {
      get: vi.fn<DraftsClient['get']>(() => pending.promise),
      set: vi
        .fn<DraftsClient['set']>()
        .mockResolvedValue({ ok: true, updatedAt: '2026-10-22T21:00:00Z' }),
    };
    const driver = createChatDraftStoreDriver(drafts);
    let value = $state('');
    let attachments = $state<ContextItem[]>([]);
    const readValue = () => value;
    const readAttachments = () => attachments;
    let queued = $state(true);
    let manager!: ChatDraftManager;
    disposers.push(
      $effect.root(() => {
        manager = createChatDraftManager({
          store: driver.port,
          workspaceId: () => 'ws',
          agentId: () => 'agent',
          inputValue: () => value,
          setInputValue: (text) => {
            value = text;
          },
          contextItems: () => attachments,
          setContextItems: (items) => {
            attachments = items;
          },
          applyEditorContent: () => undefined,
        });
        $effect(() => {
          if (!queued || manager.gateActive || manager.restorePending) return;
          value = appendInlineVisualDraft(value, {
            title: 'Clamp',
            state: 1,
            inputs: { force: 12 },
            results: { pressure: 24 },
          });
          queued = false;
        });
      }),
    );
    disposers.push(() => driver.stop());
    flushSync();
    expect(manager.restorePending).toBe(true);
    await vi.advanceTimersByTimeAsync(5100);
    flushSync();
    expect(manager.gateActive).toBe(false);
    expect(manager.restorePending).toBe(true);
    expect(readValue()).toBe('');
    expect(drafts.set).not.toHaveBeenCalled();
    pending.resolve({
      text: 'My existing question',
      updatedAt: '2026-10-22T21:00:00Z',
      attachments: [
        {
          id: 'image',
          type: 'file',
          label: 'photo.png',
          imageData: 'AAA',
          imageMimeType: 'image/png',
        },
      ],
    });
    await settle();
    expect(manager.restorePending).toBe(false);
    expect(readValue()).toContain('My existing question\n\nClamp');
    expect(readAttachments()).toHaveLength(1);
    expect(readAttachments()[0].id).toBe('image');
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(drafts.set).toHaveBeenCalledWith(
      'ws',
      'agent',
      readValue(),
      expect.arrayContaining([expect.objectContaining({ id: 'image' })]),
    );
  });

  it('ends restore waiting when send invalidation takes ownership', () => {
    const driver = createChatDraftStoreDriver({ get: () => new Promise(() => {}), set: vi.fn() });
    let manager!: ChatDraftManager;
    disposers.push(
      $effect.root(() => {
        manager = createChatDraftManager({
          store: driver.port,
          workspaceId: () => 'ws',
          agentId: () => 'agent',
          inputValue: () => '',
          setInputValue: () => undefined,
          contextItems: () => [],
          setContextItems: () => undefined,
          applyEditorContent: () => undefined,
        });
      }),
    );
    disposers.push(() => driver.stop());
    flushSync();
    expect(manager.restorePending).toBe(true);
    manager.invalidatePendingRestore();
    expect(manager.restorePending).toBe(false);
  });
});
