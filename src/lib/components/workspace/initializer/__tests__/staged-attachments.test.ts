/**
 * Staged-attachment redemption at workspace.create (PROTOCOL §5.9).
 *
 * Pre-workspace surfaces (new-workspace modal, onboarding) stage non-image
 * files as path-only context items; `redeemStagedAttachments` places each
 * from its `sourcePath` once the workspace exists (transport-aware: the
 * data arm carries the bytes when the backend is remote). Failures (stale
 * path, missing path, daemon error) mark the item `failed` — visible pill,
 * blocks the first-message send — never a silent drop.
 */
import { describe, expect, it, vi } from 'vitest';

// The default key minter reads the daemon protocol version off the store;
// with no version known it mints nothing (pre-9.13 behavior).
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ daemonHealth: { hostLocality: null, transport: null, stats: null } }),
  });
});

import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  ImagePlacementError,
  type WireImageBlock,
} from '$lib/components/chat/input/image-attachment-placement';
import {
  heldImageBlocks,
  redeemStagedAttachments,
  retainImagePlacementIdentity,
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

const KEY = '3f2b6c1e-9d3a-4e7b-8a2c-5f1d0e9b7c64';

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

  describe('idempotencyKey (v9.13)', () => {
    it('mints a key on first placement, sends it, and keeps it on the placed item', async () => {
      const place = vi.fn().mockResolvedValue({
        ok: true,
        path: '.intent/attachments/notes.txt',
        fileName: 'notes.txt',
        size: 1024,
        attachmentId: 'att-uuid-1',
        mimeType: 'text/plain',
        uploadedAt: '2026-08-12T00:00:00Z',
      });
      const mintKey = vi.fn(() => KEY);

      const result = await redeemStagedAttachments('ws-1', [stagedItem()], place, mintKey);

      expect(mintKey).toHaveBeenCalledTimes(1);
      expect(place).toHaveBeenCalledWith('ws-1', 'notes.txt', {
        sourcePath: '/home/user/notes.txt',
        mimeType: 'text/plain',
        idempotencyKey: KEY,
      });
      expect(result.items[0].placementIdempotencyKey).toBe(KEY);
    });

    it('keeps the minted key on a failed item so the retry reuses it instead of re-minting', async () => {
      const place = vi.fn().mockRejectedValue(new Error('Request timed out'));
      const mintKey = vi.fn(() => KEY);

      const first = await redeemStagedAttachments('ws-1', [stagedItem()], place, mintKey);
      expect(first.items[0].placementStatus).toBe('failed');
      expect(first.items[0].placementIdempotencyKey).toBe(KEY);

      // Retry re-calls with the items as returned: same key, no new mint.
      const retryMint = vi.fn(() => 'another-key');
      await redeemStagedAttachments('ws-1', first.items, place, retryMint);

      expect(retryMint).not.toHaveBeenCalled();
      expect(place).toHaveBeenLastCalledWith('ws-1', 'notes.txt', {
        sourcePath: '/home/user/notes.txt',
        mimeType: 'text/plain',
        idempotencyKey: KEY,
      });
    });

    it('sends no key and stores none against a pre-9.13 daemon (behavior unchanged)', async () => {
      const place = vi.fn().mockResolvedValue({
        ok: true,
        path: '.intent/attachments/notes.txt',
        fileName: 'notes.txt',
        size: 1024,
        attachmentId: 'att-uuid-1',
        mimeType: 'text/plain',
        uploadedAt: '2026-08-12T00:00:00Z',
      });

      const result = await redeemStagedAttachments('ws-1', [stagedItem()], place, () => undefined);

      const [, , source] = place.mock.calls[0];
      expect(source).toEqual({ sourcePath: '/home/user/notes.txt', mimeType: 'text/plain' });
      expect('idempotencyKey' in source).toBe(false);
      expect('placementIdempotencyKey' in result.items[0]).toBe(false);
    });
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

// What `stubToReferences` turns `heldMessage().imageBlocks` into — the blocks a
// send failing after placement must hand back for the retry.
const placedReferences = [{ type: 'image', attachmentId: 'attach-0', mimeType: 'image/png' }];

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

    expect(result).toEqual({
      sent: false,
      errorDetail: 'image-1.png (attachment too large)',
      // Not a placement-identity failure: the retry resends the attempted blocks as-is.
      imageBlocks: heldMessage().imageBlocks,
    });
    expect(request).not.toHaveBeenCalled();
  });

  describe('image placement identity across retries (v9.13)', () => {
    const imageItem = (id: string, data: string, overrides: Partial<ContextItem> = {}) =>
      ({
        id,
        type: 'file',
        label: `${id}.png`,
        imageData: data,
        imageMimeType: 'image/png',
        ...overrides,
      }) satisfies ContextItem;

    it('hands back the placement retry blocks so the resumed send replays instead of re-placing', async () => {
      const retryBlocks: WireImageBlock[] = [
        { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
        {
          type: 'image',
          data: 'ZGVm',
          mimeType: 'image/png',
          placementIdempotencyKey: KEY,
          placementFileName: 'image-1700000000000-2.png',
        },
      ];
      const failingToReferences = vi.fn(async () => {
        throw new ImagePlacementError('image-1700000000000-2.png (Request timed out)', retryBlocks);
      });

      const result = await sendHeldFirstMessage(
        heldMessage({
          imageBlocks: [
            { type: 'image', data: 'YWJj', mimeType: 'image/png' },
            { type: 'image', data: 'ZGVm', mimeType: 'image/png' },
          ],
        }),
        [],
        vi.fn(),
        failingToReferences,
      );

      expect(result.sent).toBe(false);
      expect(result.imageBlocks).toBe(retryBlocks);
    });

    it('round-trips the retained identity through the composer items (onboarding held send)', () => {
      const items = [
        imageItem('img-1', 'YWJj'),
        stagedItem(),
        imageItem('img-2', 'ZGVm'),
        imageItem('img-3', 'Z2hp'),
      ];
      // First attempt: no identity yet — plain inline blocks in item order.
      expect(heldImageBlocks(items)).toEqual([
        { type: 'image', data: 'YWJj', mimeType: 'image/png' },
        { type: 'image', data: 'ZGVm', mimeType: 'image/png' },
        { type: 'image', data: 'Z2hp', mimeType: 'image/png' },
      ]);

      // The failed attempt placed img-1, failed img-2 (keyed) and img-3 (unkeyed daemon).
      const retained = retainImagePlacementIdentity(items, [
        { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
        {
          type: 'image',
          data: 'ZGVm',
          mimeType: 'image/png',
          placementIdempotencyKey: KEY,
          placementFileName: 'image-1700000000000-2.png',
        },
        { type: 'image', data: 'Z2hp', mimeType: 'image/png' },
      ]);

      expect(retained[1]).toBe(items[1]);
      expect(retained[0]).toEqual({ ...items[0], placementAttachmentId: 'att-first' });
      expect(retained[2]).toEqual({
        ...items[2],
        placementIdempotencyKey: KEY,
        placementFileName: 'image-1700000000000-2.png',
      });
      expect(retained[3]).toEqual(items[3]);
      // The resumed send carries the identity on the same block positions:
      // the placed image as a reference, the keyed one as the same placement.
      expect(heldImageBlocks(retained)).toEqual([
        { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
        {
          type: 'image',
          data: 'ZGVm',
          mimeType: 'image/png',
          placementIdempotencyKey: KEY,
          placementFileName: 'image-1700000000000-2.png',
        },
        { type: 'image', data: 'Z2hp', mimeType: 'image/png' },
      ]);
    });

    it('leaves the items untouched when the failure carried no retry blocks', () => {
      const items = [imageItem('img-1', 'YWJj')];
      expect(retainImagePlacementIdentity(items, undefined)).toBe(items);
    });

    it('resumes a partial placement failure with a reference for the image that placed, not a second placement', async () => {
      // Attempt 1: img-1 places, img-2 fails (keyed) → the send never happens.
      const items = [imageItem('img-1', 'YWJj'), imageItem('img-2', 'ZGVm')];
      const attempt1 = await sendHeldFirstMessage(
        heldMessage({ imageBlocks: heldImageBlocks(items) }),
        [],
        vi.fn(),
        vi.fn(async () => {
          throw new ImagePlacementError('image-2.png (Request timed out)', [
            { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
            {
              type: 'image',
              data: 'ZGVm',
              mimeType: 'image/png',
              placementIdempotencyKey: KEY,
              placementFileName: 'image-2.png',
            },
          ]);
        }),
      );
      const retained = retainImagePlacementIdentity(items, attempt1.imageBlocks);
      expect(retained[0]).toEqual({ ...items[0], placementAttachmentId: 'att-first' });

      // Attempt 2: the placer sees img-1 as a reference (passed through) and
      // img-2 as the same keyed placement — exactly one image to place.
      const toReferences = vi.fn(async (_wsId: string, blocks: WireImageBlock[]) =>
        blocks.map((block) => ({
          type: 'image' as const,
          attachmentId: 'attachmentId' in block ? block.attachmentId : 'att-second',
          mimeType: 'image/png',
        })),
      );
      const request = vi.fn().mockResolvedValue({ success: true });
      const attempt2 = await sendHeldFirstMessage(
        heldMessage({ imageBlocks: heldImageBlocks(retained) }),
        [],
        request,
        toReferences,
      );

      expect(attempt2).toEqual({ sent: true });
      expect(toReferences).toHaveBeenCalledWith('ws-1', [
        { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
        {
          type: 'image',
          data: 'ZGVm',
          mimeType: 'image/png',
          placementIdempotencyKey: KEY,
          placementFileName: 'image-2.png',
        },
      ]);
      expect(request).toHaveBeenCalledWith(
        'agent.sendMessage',
        expect.objectContaining({
          imageBlocks: [
            { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
            { type: 'image', attachmentId: 'att-second', mimeType: 'image/png' },
          ],
        }),
      );
    });

    it('resumes a send that failed after placement with references only — the image is never placed twice', async () => {
      const items = [imageItem('img-1', 'YWJj')];
      const attempt1 = await sendHeldFirstMessage(
        heldMessage({ imageBlocks: heldImageBlocks(items) }),
        [],
        vi.fn().mockRejectedValue(new Error('Request timed out')),
        stubToReferences,
      );
      expect(attempt1.sent).toBe(false);
      const retained = retainImagePlacementIdentity(items, attempt1.imageBlocks);
      expect(retained[0]).toEqual({ ...items[0], placementAttachmentId: 'attach-0' });

      const toReferences = vi.fn(stubToReferences);
      const request = vi.fn().mockResolvedValue({ success: true });
      const attempt2 = await sendHeldFirstMessage(
        heldMessage({ imageBlocks: heldImageBlocks(retained) }),
        [],
        request,
        toReferences,
      );

      expect(attempt2).toEqual({ sent: true });
      // No inline data reaches the placer on the retry.
      expect(toReferences).toHaveBeenCalledWith('ws-1', [
        { type: 'image', attachmentId: 'attach-0', mimeType: 'image/png' },
      ]);
      expect(request).toHaveBeenCalledWith(
        'agent.sendMessage',
        expect.objectContaining({
          imageBlocks: [{ type: 'image', attachmentId: 'attach-0', mimeType: 'image/png' }],
        }),
      );
    });
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

    expect(result).toEqual({
      sent: false,
      errorDetail: 'unknown agent id: agent-1',
      imageBlocks: placedReferences,
    });
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
      imageBlocks: placedReferences,
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

    expect(result).toEqual({ sent: false, errorDetail: undefined, imageBlocks: placedReferences });
  });

  it('omits imageBlocks from a failed send that carried no images (nothing to replay)', async () => {
    const request = vi.fn().mockResolvedValue({ success: false, error: 'agent busy' });

    const result = await sendHeldFirstMessage(
      heldMessage({ imageBlocks: [] }),
      [fileBlock],
      request,
    );

    expect(result).toEqual({ sent: false, errorDetail: 'agent busy' });
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
