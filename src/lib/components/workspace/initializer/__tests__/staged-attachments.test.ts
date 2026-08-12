/**
 * Staged-attachment redemption at workspace.create (PROTOCOL §5.9).
 *
 * Pre-workspace surfaces (new-workspace modal, onboarding) stage non-image
 * files as path-only context items; `redeemStagedAttachments` places each
 * from its `sourcePath` once the workspace exists. Failures (stale path,
 * missing path, daemon error) mark the item `failed` — visible pill, blocks
 * the first-message send — never a silent drop, never a base64 fallback.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ContextItem } from '$lib/components/chat/input/context-api';
import { redeemStagedAttachments } from '../staged-attachments';

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
    expect(result.items[0].attachmentId).toBeUndefined();
    expect(result.fileBlocks).toEqual([]);
  });

  it('an item with no sourcePath fails without calling placeAttachment (no base64 fallback)', async () => {
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
    const place = vi
      .fn()
      .mockRejectedValueOnce(new Error('stale'))
      .mockResolvedValueOnce({
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
