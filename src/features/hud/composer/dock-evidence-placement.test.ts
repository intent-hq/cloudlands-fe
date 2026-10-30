import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockEvidenceImage, DockImagePlacementRecord } from '$shared/dock-evidence';
import type { PlaceAttachmentResult } from '$lib/components/chat/input/context-api';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  __resetDockRetentionProbesForTests,
  DockEvidencePlacementError,
  DockPlacementBackendChangedError,
  DockRawRetentionContractError,
  probeDockAttachmentCapabilities,
  placeDockEvidenceImages,
  type DockPlacementApi,
  type DockPlacementBinding,
} from './dock-evidence-placement';

const NOW = Date.parse('2026-10-29T20:00:00Z');
const binding: DockPlacementBinding = { backendId: 'local', generation: 3, transport: 'ipc' };

function image(id: string): DockEvidenceImage {
  return {
    id,
    contextItemId: `item-${id}`,
    width: 2880,
    height: 1800,
    displayScale: 2,
    capturedAt: '2026-10-29T19:59:00Z',
    source: 'capture',
  };
}
const input = (id: string, signature = `sig-${id}`) => ({
  image: image(id),
  signature,
  composite: { base64: `composite-${id}`, mimeType: 'image/jpeg' },
  raw: { base64: `raw-${id}`, mimeType: 'image/png' },
});

function rpcError(message: string) {
  return Object.assign(new Error(message), { rpcCode: -32602 });
}

/** Scripted daemon: records every call; behavior overridable per test. */
function daemon(
  options: {
    retention?: unknown;
    chief?: unknown;
    echo?: 'ok' | 'none' | 'mismatch';
    unkeyed?: boolean;
  } = {},
) {
  let keys = 0;
  let current = true;
  const calls: { fileName: string; source: Parameters<DockPlacementApi['placeImage']>[2] }[] = [];
  const lookups: string[] = [];
  const placeImage = vi.fn<DockPlacementApi['placeImage']>(async (_ws, fileName, source) => {
    calls.push({ fileName, source });
    const attachmentId = `att-${calls.length}`;
    const result: PlaceAttachmentResult = {
      ok: true,
      path: fileName,
      fileName,
      size: 1,
      attachmentId,
      mimeType: source.mimeType,
      uploadedAt: '2026-10-29T20:00:00Z',
    };
    if (source.rawScreenshot && options.echo !== 'none')
      result.rawScreenshot = {
        compositeAttachmentId:
          options.echo === 'mismatch' ? 'someone-else' : source.rawScreenshot.compositeAttachmentId,
        expiresAt: '2026-10-30T20:00:01Z',
        retentionSeconds: 86400,
      };
    return result;
  });
  const api: DockPlacementApi = {
    current: () => current,
    capabilities: async () => ({
      server: {
        capabilities: {
          rawScreenshotRetention: options.retention,
          chiefAttachments: options.chief,
        },
      },
    }),
    placeImage,
    lookup: vi.fn(async (_ws, key) => {
      lookups.push(key);
      throw rpcError('unknown idempotencyKey');
    }),
    mintKey: (existing) => (options.unkeyed ? undefined : (existing ?? `key-${++keys}`)),
  };
  return {
    api,
    calls,
    lookups,
    placeImage,
    loseBackend: () => {
      current = false;
    },
  };
}

async function run(
  api: DockPlacementApi,
  images = [input('a')],
  records: Record<string, DockImagePlacementRecord> = {},
  workspaceId = 'ws',
) {
  const saved: DockImagePlacementRecord[] = [];
  const result = await placeDockEvidenceImages({
    workspaceId,
    binding,
    images,
    records,
    onRecord: (record) => saved.push(record),
    api,
    now: () => NOW,
  }).catch((error: unknown) => error);
  const latest = Object.fromEntries(saved.map((record) => [record.imageId, record]));
  return { result, saved, latest };
}

beforeEach(() => __resetDockRetentionProbesForTests());

describe('dock evidence pre-placement', () => {
  it('never uploads raw bytes to a daemon without the retention capability', async () => {
    for (const retention of [undefined, 0, true, '1']) {
      __resetDockRetentionProbesForTests();
      const fake = daemon({ retention });
      const { result } = await run(fake.api);
      expect(fake.calls.map((call) => call.source.data)).toEqual(['composite-a']);
      expect(fake.calls[0].source.rawScreenshot).toBeUndefined();
      expect(result).toEqual([expect.objectContaining({ raw: null, rawSettled: false })]);
    }
  });

  it('places the composite then its raw with distinct keys and keeps the server deadline', async () => {
    const fake = daemon({ retention: 1 });
    const { result } = await run(fake.api, [input('a'), input('b')]);
    expect(
      fake.calls.map(({ source }) => [source.data, source.idempotencyKey, source.rawScreenshot]),
    ).toEqual([
      ['composite-a', 'key-1', undefined],
      ['raw-a', 'key-2', { compositeAttachmentId: 'att-1' }],
      ['composite-b', 'key-3', undefined],
      ['raw-b', 'key-4', { compositeAttachmentId: 'att-3' }],
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        composite: { attachmentId: 'att-1', mimeType: 'image/jpeg' },
        raw: { attachmentId: 'att-2', expiresAt: '2026-10-30T20:00:01Z' },
      }),
      expect.objectContaining({
        raw: { attachmentId: 'att-4', expiresAt: '2026-10-30T20:00:01Z' },
      }),
    ]);
  });

  it.each(['none', 'mismatch'] as const)(
    'fails before admission on an advertised retention with %s echo, keeping keys for an exact resume',
    async (echo) => {
      const fake = daemon({ retention: 1, echo });
      const first = await run(fake.api);
      expect(first.result).toBeInstanceOf(DockEvidencePlacementError);
      expect((first.result as DockEvidencePlacementError).failure).toBeInstanceOf(
        DockRawRetentionContractError,
      );
      // No claim; the composite reference and both keys are the resumable state.
      expect(first.latest.a).toMatchObject({
        composite: { attachmentId: 'att-1' },
        compositeKey: 'key-1',
        rawKey: 'key-2',
        raw: null,
        rawSettled: false,
      });
      // The next click recovers the same raw by its key: no second upload of either image.
      fake.api.lookup = vi.fn(async (_ws, key) => ({
        attachmentId: 'att-2',
        fileName: 'original.png',
        size: 1,
        uploadedAt: '',
        path: 'p',
        exists: true,
        rawScreenshot: {
          compositeAttachmentId: 'att-1',
          expiresAt: '2026-10-30T20:00:01Z',
          expired: false,
          ...(key === 'key-2' ? {} : { compositeAttachmentId: 'wrong-key' }),
        },
      }));
      const uploads = fake.placeImage.mock.calls.length;
      const resumed = await run(fake.api, [input('a')], first.latest);
      expect(fake.api.lookup).toHaveBeenCalledWith('ws', 'key-2');
      expect(fake.placeImage.mock.calls.length).toBe(uploads);
      expect(resumed.result).toEqual([
        expect.objectContaining({
          raw: { attachmentId: 'att-2', expiresAt: '2026-10-30T20:00:01Z' },
        }),
      ]);
    },
  );

  it('fails before admission on a non-expiry raw refusal while retention is advertised', async () => {
    const fake = daemon({ retention: 1 });
    fake.placeImage
      .mockImplementationOnce(async (_ws, fileName, source) => ({
        ok: true,
        path: fileName,
        fileName,
        size: 1,
        attachmentId: 'att-1',
        mimeType: source.mimeType,
        uploadedAt: '',
      }))
      .mockRejectedValueOnce(rpcError('composite att-1 already has a raw screenshot'));
    const { result, latest } = await run(fake.api);
    expect((result as DockEvidencePlacementError).failure).toEqual(
      expect.objectContaining({ reason: 'refused' }),
    );
    expect(latest.a).toMatchObject({ rawKey: 'key-2', raw: null, rawSettled: false });
  });

  it('never sends raw bytes without keyed placement even when retention is advertised', async () => {
    const fake = daemon({ retention: 1, unkeyed: true });
    const { result } = await run(fake.api);
    expect((result as DockEvidencePlacementError).failure).toEqual(
      expect.objectContaining({ reason: 'unkeyed' }),
    );
    expect(fake.calls.map((call) => call.source.data)).toEqual(['composite-a']);
  });

  it('retains assistant-workspace raws only when both capabilities are advertised', async () => {
    const onlyRetention = daemon({ retention: 1 });
    await run(onlyRetention.api, [input('a')], {}, CHIEF_WORKSPACE_ID);
    expect(onlyRetention.calls.map((call) => call.source.data)).toEqual(['composite-a']);
    __resetDockRetentionProbesForTests();
    const both = daemon({ retention: 1, chief: 1 });
    const { result } = await run(both.api, [input('a')], {}, CHIEF_WORKSPACE_ID);
    expect(both.calls.map((call) => call.source.data)).toEqual(['composite-a', 'raw-a']);
    expect(result).toEqual([
      expect.objectContaining({ raw: expect.objectContaining({ attachmentId: 'att-2' }) }),
    ]);
  });

  it('reads the capability shape the transports publish from the acknowledged hello', async () => {
    // Exactly what json-rpc-client.getNodeCapabilities() is wrapped into by BACKEND.NODE_CAPABILITIES
    // and what the web transport's observeNodeCapabilities() resolves.
    const published = {
      server: {
        capabilities: {
          agentNodes: 0,
          localNodeIsolation: 0,
          agentPlatformRouting: 0,
          workspaceMembershipEvents: 0,
          rawScreenshotRetention: 1,
          chiefAttachments: 0,
        },
      },
    };
    const fake = daemon();
    fake.api.capabilities = async () => published;
    await expect(probeDockAttachmentCapabilities(binding, fake.api)).resolves.toEqual({
      rawRetention: true,
      chiefAttachments: false,
    });
    __resetDockRetentionProbesForTests();
    fake.api.capabilities = async () => ({ server: { capabilities: null } });
    await expect(probeDockAttachmentCapabilities(binding, fake.api)).resolves.toEqual({
      rawRetention: false,
      chiefAttachments: false,
    });
  });

  it('degrades an expired keyed raw replay to composite-only without renewing it', async () => {
    const fake = daemon({ retention: 1 });
    fake.placeImage.mockImplementationOnce(async (_ws, fileName, source) => ({
      ok: true,
      path: fileName,
      fileName,
      size: 1,
      attachmentId: 'att-composite',
      mimeType: source.mimeType,
      uploadedAt: '',
    }));
    fake.placeImage.mockRejectedValueOnce(
      rpcError(
        // The exact router-prefixed wire message.
        'invalid params: rawScreenshotExpired: raw screenshot att-raw expired at 2026-10-29T19:00:00.000Z; retention is not renewable',
      ),
    );
    const { result } = await run(fake.api);
    expect(result).toEqual([
      expect.objectContaining({
        composite: { attachmentId: 'att-composite', mimeType: 'image/jpeg' },
        raw: null,
        rawSettled: true,
      }),
    ]);
    expect(fake.placeImage).toHaveBeenCalledTimes(2);
  });

  it('treats an expired by-key lookup as composite-only on resume', async () => {
    const fake = daemon({ retention: 1 });
    const placed = await run(fake.api);
    const resumable = {
      a: { ...placed.latest.a, raw: null, rawSettled: false, rawKey: 'key-raw' },
    };
    fake.api.lookup = vi.fn(async () => ({
      attachmentId: 'att-raw',
      fileName: 'original.png',
      size: 1,
      uploadedAt: '',
      path: 'p',
      exists: false,
      rawScreenshot: {
        compositeAttachmentId: placed.latest.a.composite!.attachmentId,
        expiresAt: '2026-10-29T19:00:00.000Z',
        expired: true,
      },
    }));
    const calls = fake.placeImage.mock.calls.length;
    const resumed = await run(fake.api, [input('a')], resumable);
    expect(fake.api.lookup).toHaveBeenCalledWith('ws', 'key-raw');
    expect(fake.placeImage.mock.calls.length).toBe(calls);
    expect(resumed.result).toEqual([expect.objectContaining({ raw: null, rawSettled: true })]);
  });

  it('records the key before a lost reply and resumes by key on the next click without a second upload', async () => {
    const fake = daemon({ retention: 0 });
    fake.placeImage.mockRejectedValueOnce(new Error('socket closed'));
    const first = await run(fake.api);
    expect(first.result).toBeInstanceOf(DockEvidencePlacementError);
    expect(first.latest.a).toMatchObject({ compositeKey: 'key-1', composite: null });
    fake.api.lookup = vi.fn(async () => ({
      attachmentId: 'att-recovered',
      fileName: 'screenshot.jpg',
      mimeType: 'image/jpeg',
      size: 1,
      uploadedAt: '',
      path: 'p',
      exists: true,
    }));
    const second = await run(fake.api, [input('a')], first.latest);
    expect(fake.api.lookup).toHaveBeenCalledWith('ws', 'key-1');
    expect(fake.placeImage).toHaveBeenCalledTimes(1);
    expect(second.result).toEqual([
      expect.objectContaining({
        composite: { attachmentId: 'att-recovered', mimeType: 'image/jpeg' },
      }),
    ]);
  });

  it('reuses placed references only for the same composite, workspace and backend', async () => {
    const fake = daemon({ retention: 0 });
    const first = await run(fake.api);
    await run(fake.api, [input('a')], first.latest);
    expect(fake.placeImage).toHaveBeenCalledTimes(1);
    // New marks change the composite: the old reference and key are not reused.
    const changed = await run(fake.api, [input('a', 'sig-a-with-new-mark')], first.latest);
    expect(fake.calls.at(-1)?.source.idempotencyKey).toBe('key-2');
    expect(changed.result).toEqual([
      expect.objectContaining({ composite: expect.objectContaining({ attachmentId: 'att-2' }) }),
    ]);
    const otherBackend = await placeDockEvidenceImages({
      workspaceId: 'ws',
      binding: { ...binding, backendId: 'remote' },
      images: [input('a')],
      records: first.latest,
      onRecord: () => undefined,
      api: fake.api,
      now: () => NOW,
    });
    expect(otherBackend[0].backendId).toBe('remote');
    expect(fake.placeImage).toHaveBeenCalledTimes(3);
  });

  it('stops on a backend change and never sends the raw to the new backend', async () => {
    const fake = daemon({ retention: 1 });
    fake.placeImage.mockImplementationOnce(async (_ws, fileName, source) => {
      fake.loseBackend();
      return {
        ok: true,
        path: fileName,
        fileName,
        size: 1,
        attachmentId: 'att-1',
        mimeType: source.mimeType,
        uploadedAt: '',
      };
    });
    const { result, latest } = await run(fake.api);
    expect(result).toBeInstanceOf(DockPlacementBackendChangedError);
    expect(fake.placeImage).toHaveBeenCalledTimes(1);
    // The placed composite was not confirmed on the bound backend: no reference is kept.
    expect(latest.a).toMatchObject({ compositeKey: 'key-1', composite: null });
  });
});
