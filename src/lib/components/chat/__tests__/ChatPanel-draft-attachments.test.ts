import { describe, it, expect, vi } from 'vitest';

import type { DraftAttachment, DraftsClient } from '$lib/client/app-client';
import {
  serializeDraftAttachments,
  deserializeDraftAttachments,
} from '../chat-draft-attachments';
import type { ContextItem } from '../input/context-api';

/**
 * Tests for ChatPanel's draft attachment save/restore wiring.
 *
 * Mirrors the two $effect blocks in ChatPanel.svelte (save-draft debounce and
 * restore-on-mount) so the exact `drafts.set` params and the `drafts.get`
 * rehydration behavior are asserted against a mock DraftsClient, following the
 * extracted-logic pattern used by ChatPanel-imageBlocks.test.ts.
 */

// Mirrors ChatPanel.svelte's debounced save effect body.
function saveDraft(
  drafts: DraftsClient,
  workspaceId: string,
  agentId: string,
  inputValue: string,
  contextItems: ContextItem[],
): void {
  const currentAttachments = serializeDraftAttachments(contextItems);
  drafts.set(
    workspaceId,
    agentId,
    inputValue,
    currentAttachments.length > 0 ? currentAttachments : undefined,
  );
}

// Mirrors ChatPanel.svelte's restore-on-mount effect body.
async function restoreDraft(
  drafts: DraftsClient,
  workspaceId: string,
  agentId: string,
  state: { inputValue: string; contextItems: ContextItem[] },
): Promise<void> {
  const draft = await drafts.get(workspaceId, agentId);
  if (!draft) return;
  if (draft.attachments?.length && state.contextItems.length === 0) {
    state.contextItems = deserializeDraftAttachments(draft.attachments);
  }
  if (draft.text && !state.inputValue) {
    state.inputValue = draft.text;
  }
}

function createMockDrafts(
  getResult: { text: string; attachments?: DraftAttachment[]; updatedAt: string } | null = null,
): DraftsClient {
  return {
    get: vi.fn().mockResolvedValue(getResult),
    set: vi.fn().mockResolvedValue({ ok: true, updatedAt: '2026-07-22T00:00:00Z' }),
    clear: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const imageItem: ContextItem = {
  id: 'file-upload-1-cat.png',
  type: 'file',
  label: 'cat.png',
  file: new File(['x'], 'cat.png', { type: 'image/png' }),
  imageData: 'aGVsbG8=',
  imageMimeType: 'image/png',
};

const plainItem: ContextItem = { id: 'ctx-1', type: 'file', label: 'README.md' };

describe('ChatPanel draft attachment save', () => {
  it('sends attachments on drafts.set when image context items are present', () => {
    const drafts = createMockDrafts();

    saveDraft(drafts, 'ws-1', 'agent-1', 'hello', [imageItem, plainItem]);

    expect(drafts.set).toHaveBeenCalledExactlyOnceWith('ws-1', 'agent-1', 'hello', [
      {
        id: 'file-upload-1-cat.png',
        type: 'file',
        label: 'cat.png',
        imageData: 'aGVsbG8=',
        imageMimeType: 'image/png',
      },
    ]);
  });

  it('omits the attachments param when no image context items are present', () => {
    const drafts = createMockDrafts();

    saveDraft(drafts, 'ws-1', 'agent-1', 'text only', [plainItem]);

    expect(drafts.set).toHaveBeenCalledExactlyOnceWith('ws-1', 'agent-1', 'text only', undefined);
  });
});

describe('ChatPanel draft attachment restore', () => {
  it('rehydrates contextItems (without a File handle) from a drafts.get response', async () => {
    const drafts = createMockDrafts({
      text: 'draft text',
      attachments: [
        {
          id: 'file-upload-1-cat.png',
          type: 'file',
          label: 'cat.png',
          imageData: 'aGVsbG8=',
          imageMimeType: 'image/png',
        },
      ],
      updatedAt: '2026-07-22T00:00:00Z',
    });
    const state = { inputValue: '', contextItems: [] as ContextItem[] };

    await restoreDraft(drafts, 'ws-1', 'agent-1', state);

    expect(drafts.get).toHaveBeenCalledExactlyOnceWith('ws-1', 'agent-1');
    expect(state.contextItems).toHaveLength(1);
    expect(state.contextItems[0]).toEqual({
      id: 'file-upload-1-cat.png',
      type: 'file',
      label: 'cat.png',
      imageData: 'aGVsbG8=',
      imageMimeType: 'image/png',
    });
    expect(state.contextItems[0].file).toBeUndefined();
    expect(state.inputValue).toBe('draft text');
  });

  it('does not overwrite existing contextItems on restore', async () => {
    const drafts = createMockDrafts({
      text: '',
      attachments: [
        { id: 'a', type: 'file', label: 'a.png', imageData: 'eA==', imageMimeType: 'image/png' },
      ],
      updatedAt: '2026-07-22T00:00:00Z',
    });
    const state = { inputValue: '', contextItems: [plainItem] };

    await restoreDraft(drafts, 'ws-1', 'agent-1', state);

    expect(state.contextItems).toEqual([plainItem]);
  });

  it('leaves state untouched when no draft exists', async () => {
    const drafts = createMockDrafts(null);
    const state = { inputValue: '', contextItems: [] as ContextItem[] };

    await restoreDraft(drafts, 'ws-1', 'agent-1', state);

    expect(state.contextItems).toEqual([]);
    expect(state.inputValue).toBe('');
  });
});
