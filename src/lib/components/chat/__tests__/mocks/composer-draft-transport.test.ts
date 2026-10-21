import { describe, expect, it, vi } from 'vitest';
import { createComposerDraftTransport } from './composer-draft-transport';

const workspaceId = 'workspace';
const agentId = 'agent';
const updatedAt = '2026-08-23T12:00:00.000Z';

describe('composer fixture drafts transport', () => {
  it('holds a protocol-shaped restore until explicitly released', async () => {
    const onRequest = vi.fn();
    const fixture = createComposerDraftTransport(workspaceId, agentId, 'saved', true, onRequest);
    const settled = vi.fn();
    const result = fixture.transport.get(workspaceId, agentId).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      method: 'drafts.get',
      params: { workspaceId, agentId },
    });
    fixture.releaseRestore();
    await result;
    expect(settled).toHaveBeenCalledExactlyOnceWith({ text: 'saved', updatedAt });
  });

  it('persists isolated drafts, omits empty attachments, and clears idempotently', async () => {
    const onRequest = vi.fn();
    const { transport } = createComposerDraftTransport(workspaceId, agentId, '', false, onRequest);
    expect(await transport.get(workspaceId, agentId)).toBeNull();
    expect(await transport.set(workspaceId, agentId, 'edited', [])).toEqual({
      ok: true,
      updatedAt,
    });
    expect(onRequest).toHaveBeenLastCalledWith({
      method: 'drafts.set',
      params: { workspaceId, agentId, text: 'edited' },
    });
    expect(await transport.get(workspaceId, agentId)).toEqual({ text: 'edited', updatedAt });
    expect(await transport.get(workspaceId, 'other')).toBeNull();
    expect(await transport.get('other', agentId)).toBeNull();
    expect(await transport.clear(workspaceId, agentId)).toEqual({ ok: true });
    expect(onRequest).toHaveBeenLastCalledWith({
      method: 'drafts.clear',
      params: { workspaceId, agentId },
    });
    expect(await transport.clear(workspaceId, agentId)).toEqual({ ok: true });
    expect(await transport.get(workspaceId, agentId)).toBeNull();
  });

  it('retains attachment-only drafts and clears empty writes', async () => {
    const { transport } = createComposerDraftTransport(workspaceId, agentId);
    const attachments = [{ id: 'image', type: 'image', label: 'Image', imageData: 'base64-image' }];
    await transport.set(workspaceId, agentId, '', attachments);
    attachments[0].imageData = 'changed outside transport';
    expect(await transport.get(workspaceId, agentId)).toEqual({
      text: '',
      attachments: [{ id: 'image', type: 'image', label: 'Image', imageData: 'base64-image' }],
      updatedAt,
    });
    await transport.set(workspaceId, agentId, '');
    expect(await transport.get(workspaceId, agentId)).toBeNull();
  });

  it('releases held requests without restoring stale content on disposal', async () => {
    const fixture = createComposerDraftTransport(workspaceId, agentId, 'stale', true);
    const request = fixture.transport.get(workspaceId, agentId);
    fixture.dispose();
    expect(await request).toBeNull();
  });
});
