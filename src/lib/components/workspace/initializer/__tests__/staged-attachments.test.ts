/**
 * Staged-attachment redemption at workspace.create (PROTOCOL §5.9).
 *
 * Pre-workspace surfaces stage non-image
 * files as path-only context items; `redeemStagedAttachments` places each
 * from its `sourcePath` once the workspace exists (transport-aware: the
 * data arm carries the bytes when the backend is remote). Failures (stale
 * path, missing path, daemon error) mark the item `failed` — visible pill,
 * blocks the first-message send — never a silent drop.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  redeemStagedAttachments,
  sendHeldFirstMessage,
  type HeldFirstMessage,
} from '../staged-attachments';

const stagedItem = (overrides: Partial<ContextItem> = {}): ContextItem => ({
  id: 'staged-file-1',
  type: 'file',
  label: 'notes.txt',
  path: 'notes.txt',
  attachmentMimeType: 'text/plain',
  attachmentSize: 1024,
  sourcePath: '/home/user/notes.txt',
  ...overrides,
});

const placeOk = vi.fn().mockResolvedValue({
  ok: true,
  path: '.intent/attachments/notes.txt',
  fileName: 'notes.txt',
  size: 1024,
  attachmentId: 'att-uuid-1',
  mimeType: 'text/plain',
  uploadedAt: '2026-08-12T00:00:00Z',
});

describe('redeemStagedAttachments', () => {
  it('places staged items from their sourcePath and returns attachment-reference blocks', async () => {
    const place = vi.fn().mockResolvedValue({
      ok: true,
      path: '.intent/attachments/notes.txt',
      fileName: 'notes.txt',
      size: 1024,
      attachmentId: 'att-uuid-1',
      mimeType: 'text/plain',
      uploadedAt: '2026-08-12T00:00:00Z',
    });

    const result = await redeemStagedAttachments('ws-1', [stagedItem()], place);

    expect(place).toHaveBeenCalledWith('ws-1', 'notes.txt', {
      sourcePath: '/home/user/notes.txt',
      mimeType: 'text/plain',
    });
    expect(result.failedCount).toBe(0);
    expect(result.items[0].placementStatus).toBe('placed');
    expect(result.items[0].attachmentId).toBe('att-uuid-1');
    expect(result.fileBlocks).toEqual([
      {
        type: 'file',
        attachmentId: 'att-uuid-1',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        size: 1024,
      },
    ]);
  });

  it('stale path at redemption: item flips to failed, counts, and yields no block', async () => {
    // The draft persisted a path that no longer exists — the daemon rejects
    // the placement. The item must stay visible as a failed pill (blocks the
    // send), not disappear.
    const place = vi.fn().mockRejectedValue(new Error('source file not found'));

    const result = await redeemStagedAttachments('ws-1', [stagedItem()], place);

    expect(result.failedCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].placementStatus).toBe('failed');
    // The daemon's failure reason is captured for the failed pill tooltip.
    expect(result.items[0].placementError).toBe('source file not found');
    expect(result.items[0].attachmentId).toBeUndefined();
    expect(result.fileBlocks).toEqual([]);
  });

  it('an item with no sourcePath fails without calling placeAttachment (nothing to read from)', async () => {
    const place = vi.fn();

    const result = await redeemStagedAttachments(
      'ws-1',
      [stagedItem({ sourcePath: '', placementStatus: 'failed' })],
      place,
    );

    expect(place).not.toHaveBeenCalled();
    expect(result.failedCount).toBe(1);
    expect(result.items[0].placementStatus).toBe('failed');
  });

  it('is fail-soft per item: one failure does not stop the rest', async () => {
    const place = vi.fn().mockRejectedValueOnce(new Error('stale')).mockResolvedValueOnce({
      ok: true,
      path: '.intent/attachments/b.txt',
      fileName: 'b.txt',
      size: 2,
      attachmentId: 'att-uuid-2',
      mimeType: 'text/plain',
      uploadedAt: '2026-08-12T00:00:00Z',
    });

    const result = await redeemStagedAttachments(
      'ws-1',
      [
        stagedItem({ id: 'a', label: 'a.txt', sourcePath: '/home/user/a.txt' }),
        stagedItem({ id: 'b', label: 'b.txt', sourcePath: '/home/user/b.txt' }),
      ],
      place,
    );

    expect(result.failedCount).toBe(1);
    expect(result.items[0].placementStatus).toBe('failed');
    expect(result.items[1].placementStatus).toBe('placed');
    expect(result.fileBlocks).toHaveLength(1);
    expect(result.fileBlocks[0].attachmentId).toBe('att-uuid-2');
  });

  it('re-redemption skips already-placed items (retry after partial failure is idempotent)', async () => {
    const placed = stagedItem({
      id: 'done',
      placementStatus: 'placed',
      attachmentId: 'att-uuid-1',
      path: '.intent/attachments/notes.txt',
    });

    const result = await redeemStagedAttachments('ws-1', [placed], placeOk);

    expect(placeOk).not.toHaveBeenCalled();
    expect(result.failedCount).toBe(0);
    expect(result.items).toEqual([placed]);
    // The placed item still contributes its attachment-reference block.
    expect(result.fileBlocks).toEqual([
      {
        type: 'file',
        attachmentId: 'att-uuid-1',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        size: 1024,
      },
    ]);
  });
});

/**
 * Simulate a Svelte `$state` deep-reactive value: `$state` wraps objects and
 * their nested arrays/objects in Proxies, and Electron's structured clone
 * (`ipcRenderer.invoke`) rejects ANY Proxy with "An object could not be
 * cloned" — the exact failure behind monorepo#2576.
 */
const deepProxy = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  const wrapped: any = Array.isArray(value) ? [] : {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    wrapped[key] = deepProxy(entry);
  }
  return new Proxy(wrapped, {}) as T;
};

const heldMessage = (overrides: Partial<HeldFirstMessage> = {}): HeldFirstMessage => ({
  workspaceId: 'ws-1',
  agentId: 'agent-1',
  content: 'first message',
  imageBlocks: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
  contextReferences: [{ type: 'file', path: '/tmp/a.ts', title: 'a.ts' }],
  ...overrides,
});

const fileBlock = {
  type: 'file' as const,
  attachmentId: 'att-uuid-1',
  fileName: 'notes.txt',
  mimeType: 'text/plain',
  size: 1024,
};

// Injected in place of the real toImageReferenceBlocks (monorepo#3338):
// deterministic placement stub — each inline block becomes a reference block.
const stubToReferences = vi.fn(
  async (_wsId: string, blocks: Array<{ attachmentId?: string; mimeType?: string }>) =>
    blocks.map((block, i) => ({
      type: 'image' as const,
      attachmentId: block.attachmentId ?? `attach-${i}`,
      ...(block.mimeType ? { mimeType: block.mimeType } : {}),
    })),
);

describe('sendHeldFirstMessage', () => {
  it('sends structured-clone-safe params even when the held message is a $state proxy (monorepo#2576)', async () => {
    // The held first message lives in Svelte `$state` between create and
    // send, so every nested array/object arrives as a reactive Proxy.
    const pending = deepProxy(heldMessage());
    const request = vi.fn(async (_method: string, params?: unknown) => {
      // Electron IPC structured-clones the params; a Proxy anywhere in the
      // tree throws DataCloneError and the send never reaches the daemon.
      structuredClone(params);
      return { success: true };
    });

    const result = await sendHeldFirstMessage(pending, [fileBlock], request, stubToReferences);

    expect(result).toEqual({ sent: true });
    expect(request).toHaveBeenCalledTimes(1);
    // Inline images were placed and swapped to attachment references before
    // the wire call (monorepo#3338).
    expect(request).toHaveBeenCalledWith('agent.sendMessage', {
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      content: 'first message',
      imageBlocks: [{ type: 'image', attachmentId: 'attach-0', mimeType: 'image/png' }],
      fileBlocks: [fileBlock],
      contextReferences: [{ type: 'file', path: '/tmp/a.ts', title: 'a.ts' }],
    });
  });

  it('resolves { sent: false, errorDetail } when image placement fails (never a silent drop)', async () => {
    const request = vi.fn();
    const failingToReferences = vi.fn(async () => {
      throw Object.assign(new Error('Internal error'), {
        data: { detail: 'image-1.png (attachment too large)' },
      });
    });

    const result = await sendHeldFirstMessage(
      heldMessage(),
      [fileBlock],
      request,
      failingToReferences,
    );

    expect(result).toEqual({ sent: false, errorDetail: 'image-1.png (attachment too large)' });
    expect(request).not.toHaveBeenCalled();
  });

  it('omits empty imageBlocks/fileBlocks/contextReferences instead of sending empty arrays', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });

    await sendHeldFirstMessage(
      heldMessage({ imageBlocks: [], contextReferences: [] }),
      [],
      request,
    );

    expect(request).toHaveBeenCalledWith('agent.sendMessage', {
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      content: 'first message',
    });
  });

  it('skips the send when there is no agent or nothing to deliver', async () => {
    const request = vi.fn();

    expect(
      await sendHeldFirstMessage(heldMessage({ agentId: undefined }), [fileBlock], request),
    ).toEqual({ sent: true });
    expect(
      await sendHeldFirstMessage(
        heldMessage({ content: '', imageBlocks: [], contextReferences: [] }),
        [],
        request,
      ),
    ).toEqual({ sent: true });
    expect(request).not.toHaveBeenCalled();
  });

  it('surfaces the daemon rejection reason on a { success: false } result', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'unknown agent id: agent-1' });

    const result = await sendHeldFirstMessage(
      heldMessage(),
      [fileBlock],
      request,
      stubToReferences,
    );

    expect(result).toEqual({ sent: false, errorDetail: 'unknown agent id: agent-1' });
  });

  it('surfaces the thrown error detail (structured data.detail preferred, like #1287)', async () => {
    const structured = Object.assign(new Error('Internal error'), {
      data: { detail: 'agent session vanished mid-send' },
    });
    const request = vi.fn().mockRejectedValue(structured);

    const result = await sendHeldFirstMessage(
      heldMessage(),
      [fileBlock],
      request,
      stubToReferences,
    );

    expect(result).toEqual({
      sent: false,
      errorDetail: 'agent session vanished mid-send',
      deliveryUnknown: true,
    });
  });

  it('returns no detail for generic transport fallbacks so callers keep localized copy', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Backend request failed'));

    const result = await sendHeldFirstMessage(
      heldMessage(),
      [fileBlock],
      request,
      stubToReferences,
    );

    expect(result).toEqual({ sent: false, errorDetail: undefined, deliveryUnknown: true });
  });

  it('resolves { sent: false } instead of throwing on a non-serializable held message', async () => {
    // The never-throw contract must hold even when the params rebuild itself
    // fails: a circular contextReference makes JSON.stringify throw, which
    // must resolve as a failed send (the retry state stays set), not reject.
    const circular: Record<string, unknown> = { type: 'context' };
    circular.self = circular;
    const request = vi.fn();

    const result = await sendHeldFirstMessage(
      heldMessage({ contextReferences: [circular] }),
      [fileBlock],
      request,
      stubToReferences,
    );

    expect(result.sent).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
