/**
 * Tests for the New Workspace modal draft flow (PROTOCOL §5.16 `drafts.*`
 * under the reserved sentinel keys `__new-workspace__` / `__initializer__`).
 *
 * Follows the mock-BE convention: asserts the exact params handed to the
 * `DraftsClient` seam (the wire request shape per §5.16) and feeds
 * PROTOCOL-shaped mock responses back, mirroring
 * ChatPanel-draft-attachments.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DraftAttachment, DraftsClient } from '$lib/client/app-client';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  LEGACY_PROMPT_SESSION_KEY,
  MAX_DRAFT_ATTACHMENTS_BYTES,
  NEW_WORKSPACE_DRAFT_AGENT_ID,
  NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
  buildNewWorkspaceDraftPayload,
  clearNewWorkspaceDraft,
  persistNewWorkspaceDraft,
  restoreNewWorkspaceDraft,
} from '../new-workspace-draft';

function createMockDrafts(
  getResult: { text: string; attachments?: DraftAttachment[]; updatedAt: string } | null = null,
): DraftsClient {
  return {
    get: vi.fn().mockResolvedValue(getResult),
    set: vi.fn().mockResolvedValue({ ok: true, updatedAt: '2026-07-23T00:00:00Z' }),
    clear: vi.fn().mockResolvedValue({ ok: true }),
  };
}

/** §5.16 attachment: opaque FE-authored image context item, `File` dropped. */
const IMAGE_ATTACHMENT: DraftAttachment = {
  id: 'image-1721650000000-0',
  type: 'file',
  label: 'screenshot.png',
  description: 'image/png • 12.3 KB',
  path: 'screenshot.png',
  imageData: 'iVBORw0KGgoAAAANSUhEUg==',
  imageMimeType: 'image/png',
};

const imageItem: ContextItem = {
  id: 'image-1721650000000-0',
  type: 'file',
  label: 'screenshot.png',
  file: new File(['x'], 'screenshot.png', { type: 'image/png' }),
  imageData: 'iVBORw0KGgoAAAANSUhEUg==',
  imageMimeType: 'image/png',
};

const plainItem: ContextItem = { id: 'ctx-1', type: 'file', label: 'README.md' };

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('restoreNewWorkspaceDraft', () => {
  it('issues drafts.get under the reserved sentinel keys and rehydrates text + attachments', async () => {
    const drafts = createMockDrafts({
      text: 'half-written prompt',
      attachments: [IMAGE_ATTACHMENT],
      updatedAt: '2026-07-23T00:00:00Z',
    });

    const restored = await restoreNewWorkspaceDraft(drafts);

    expect(drafts.get).toHaveBeenCalledOnce();
    expect(drafts.get).toHaveBeenCalledWith('__new-workspace__', '__initializer__');
    expect(restored).toEqual({
      text: 'half-written prompt',
      contextItems: [
        {
          id: 'image-1721650000000-0',
          type: 'file',
          label: 'screenshot.png',
          description: 'image/png • 12.3 KB',
          path: 'screenshot.png',
          imageData: 'iVBORw0KGgoAAAANSUhEUg==',
          imageMimeType: 'image/png',
        },
      ],
    });
    expect(restored!.contextItems[0].file).toBeUndefined();
  });

  it('restores a text-only draft (no attachments field) with empty contextItems', async () => {
    const drafts = createMockDrafts({ text: 'text only', updatedAt: '2026-07-23T00:00:00Z' });

    expect(await restoreNewWorkspaceDraft(drafts)).toEqual({ text: 'text only', contextItems: [] });
  });

  it('migrates the legacy sessionStorage prompt once when the daemon draft is null', async () => {
    sessionStorage.setItem(LEGACY_PROMPT_SESSION_KEY, 'legacy prompt');
    const drafts = createMockDrafts(null);

    const restored = await restoreNewWorkspaceDraft(drafts);

    expect(restored).toEqual({ text: 'legacy prompt', contextItems: [] });
    expect(sessionStorage.getItem(LEGACY_PROMPT_SESSION_KEY)).toBeNull();
  });

  it('returns null when there is no daemon draft and no legacy value', async () => {
    expect(await restoreNewWorkspaceDraft(createMockDrafts(null))).toBeNull();
  });

  it('is non-fatal when drafts.get rejects and skips the legacy migration', async () => {
    sessionStorage.setItem(LEGACY_PROMPT_SESSION_KEY, 'legacy prompt');
    const drafts = createMockDrafts();
    vi.mocked(drafts.get).mockRejectedValue(new Error('daemon unavailable'));

    expect(await restoreNewWorkspaceDraft(drafts)).toBeNull();
    expect(sessionStorage.getItem(LEGACY_PROMPT_SESSION_KEY)).toBe('legacy prompt');
  });
});

describe('buildNewWorkspaceDraftPayload', () => {
  it('serializes image context items into the drafts.set attachments array', () => {
    expect(buildNewWorkspaceDraftPayload('hello', [imageItem, plainItem])).toEqual({
      text: 'hello',
      attachments: [
        {
          id: 'image-1721650000000-0',
          type: 'file',
          label: 'screenshot.png',
          imageData: 'iVBORw0KGgoAAAANSUhEUg==',
          imageMimeType: 'image/png',
        },
      ],
    });
  });

  it('omits the attachments field when no image items are present', () => {
    const payload = buildNewWorkspaceDraftPayload('text only', [plainItem]);

    expect(payload).toEqual({ text: 'text only' });
    expect('attachments' in payload).toBe(false);
  });

  it('drops attachments (keeping text) when the serialized payload exceeds the size guard', () => {
    const oversizedItem: ContextItem = {
      ...imageItem,
      imageData: 'a'.repeat(MAX_DRAFT_ATTACHMENTS_BYTES + 1),
    };

    const payload = buildNewWorkspaceDraftPayload('still saved', [oversizedItem]);

    expect(payload).toEqual({ text: 'still saved' });
    expect('attachments' in payload).toBe(false);
  });
});

describe('persistNewWorkspaceDraft', () => {
  it('issues drafts.set under the sentinel keys with the payload text and attachments', () => {
    const drafts = createMockDrafts();

    persistNewWorkspaceDraft(drafts, { text: 'hello', attachments: [IMAGE_ATTACHMENT] });

    expect(drafts.set).toHaveBeenCalledOnce();
    expect(drafts.set).toHaveBeenCalledWith('__new-workspace__', '__initializer__', 'hello', [
      IMAGE_ATTACHMENT,
    ]);
  });

  it('passes undefined attachments through (empty text + no attachments ⇒ documented clear)', () => {
    const drafts = createMockDrafts();

    persistNewWorkspaceDraft(drafts, { text: '' });

    expect(drafts.set).toHaveBeenCalledWith('__new-workspace__', '__initializer__', '', undefined);
  });

  it('is non-fatal when drafts.set rejects', async () => {
    const drafts = createMockDrafts();
    vi.mocked(drafts.set).mockRejectedValue(new Error('daemon unavailable'));

    persistNewWorkspaceDraft(drafts, { text: 'hello' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(drafts.set).toHaveBeenCalledOnce();
  });
});

describe('clearNewWorkspaceDraft', () => {
  it('issues drafts.clear under the sentinel keys and removes the legacy sessionStorage key', () => {
    sessionStorage.setItem(LEGACY_PROMPT_SESSION_KEY, 'stale');
    const drafts = createMockDrafts();

    clearNewWorkspaceDraft(drafts);

    expect(drafts.clear).toHaveBeenCalledOnce();
    expect(drafts.clear).toHaveBeenCalledWith('__new-workspace__', '__initializer__');
    expect(sessionStorage.getItem(LEGACY_PROMPT_SESSION_KEY)).toBeNull();
  });

  it('is non-fatal when drafts.clear rejects', async () => {
    const drafts = createMockDrafts();
    vi.mocked(drafts.clear).mockRejectedValue(new Error('daemon unavailable'));

    clearNewWorkspaceDraft(drafts);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(drafts.clear).toHaveBeenCalledOnce();
  });
});

describe('sentinel constants', () => {
  it('match the reserved sentinel pair documented in PROTOCOL §5.16', () => {
    expect(NEW_WORKSPACE_DRAFT_WORKSPACE_ID).toBe('__new-workspace__');
    expect(NEW_WORKSPACE_DRAFT_AGENT_ID).toBe('__initializer__');
  });
});
