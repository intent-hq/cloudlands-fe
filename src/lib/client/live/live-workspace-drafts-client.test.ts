import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceDraft } from '$shared/types';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));

import { backendRequest } from './backend-transport';
import { LiveWorkspaceDraftsClient } from './live-workspace-drafts-client';

const mockedRequest = vi.mocked(backendRequest);
const draft: WorkspaceDraft = {
  id: 'draft-1',
  ownerClientId: 'client-1',
  revision: 4,
  phase: 'editing',
  intentText: 'Build it',
  source: null,
  contextLinks: [],
  attachments: [],
  config: {},
  operationKey: 'operation-1',
  delivery: { state: 'none' },
  createdAt: '2026-09-04T20:00:00.000Z',
  updatedAt: '2026-09-04T20:00:01.000Z',
};

describe('LiveWorkspaceDraftsClient', () => {
  afterEach(() => vi.clearAllMocks());

  it('forwards every workspaceDraft request with the protocol-defined payload', async () => {
    mockedRequest
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce([draft])
      .mockResolvedValueOnce({ ...draft, revision: 5 })
      .mockResolvedValueOnce({
        draft: { ...draft, phase: 'promoted' },
        workspace: {
          id: 'amber-forest',
          title: 'Untitled',
          status: 'active',
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
        },
        initialAgent: { id: 'agent-1', workspaceId: 'amber-forest', name: 'Coordinator' },
      })
      .mockResolvedValueOnce({ ...draft, delivery: { state: 'pending', messageId: 'message-1' } })
      .mockResolvedValueOnce({ deleted: true });
    const client = new LiveWorkspaceDraftsClient();

    await expect(client.create({ intentText: 'Build it' })).resolves.toEqual(draft);
    await expect(client.get('draft-1')).resolves.toEqual(draft);
    await expect(client.list()).resolves.toEqual([draft]);
    await expect(client.update('draft-1', 4, { title: 'Named' })).resolves.toMatchObject({
      revision: 5,
    });
    await expect(
      client.promote('draft-1', 5, {
        prompt: '',
        specialist: 'spec-writer',
      }),
    ).resolves.toMatchObject({
      draft: { phase: 'promoted' },
      workspace: { id: 'amber-forest' },
      initialAgent: { id: 'agent-1', name: 'Coordinator' },
    });
    await expect(
      client.markDelivery('draft-1', { state: 'pending', messageId: 'message-1' }),
    ).resolves.toMatchObject({ delivery: { state: 'pending', messageId: 'message-1' } });
    await expect(client.delete('draft-1')).resolves.toEqual({ deleted: true });

    expect(mockedRequest.mock.calls).toEqual([
      ['workspaceDraft.create', { intentText: 'Build it' }],
      ['workspaceDraft.get', { id: 'draft-1' }],
      ['workspaceDraft.list', {}],
      ['workspaceDraft.update', { id: 'draft-1', expectedRevision: 4, patch: { title: 'Named' } }],
      [
        'workspaceDraft.promote',
        {
          id: 'draft-1',
          expectedRevision: 5,
          initialAgent: { prompt: '', specialist: 'spec-writer' },
        },
        { timeoutMs: 120_000 },
      ],
      [
        'workspaceDraft.markDelivery',
        { id: 'draft-1', delivery: { state: 'pending', messageId: 'message-1' } },
      ],
      ['workspaceDraft.delete', { id: 'draft-1' }],
    ]);
  });
});
