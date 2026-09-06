import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));

import { backendRequest } from '$lib/client/live/backend-transport';
import { SemanticMapClient } from './client';
import {
  SEMANTIC_MAP_FIXTURE_ACTIVITIES,
  SEMANTIC_MAP_FIXTURE_ASSIGNMENTS,
  SEMANTIC_MAP_FIXTURE_MANIFEST,
  SEMANTIC_MAP_FIXTURE_ROUTE,
  SEMANTIC_MAP_FIXTURE_SOURCE,
} from './fixtures';

const mockedRequest = vi.mocked(backendRequest);

describe('SemanticMapClient', () => {
  afterEach(() => vi.clearAllMocks());

  it('maps map.get and map.classify arguments without transforming responses', async () => {
    const snapshot = {
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: SEMANTIC_MAP_FIXTURE_SOURCE,
      coverage: { matched: 3, total: 4 },
    } as const;
    mockedRequest
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(SEMANTIC_MAP_FIXTURE_ASSIGNMENTS);
    const client = new SemanticMapClient();

    await expect(client.get('ws-1')).resolves.toBe(snapshot);
    await expect(client.classify('ws-1', ['src/a.ts'])).resolves.toBe(
      SEMANTIC_MAP_FIXTURE_ASSIGNMENTS,
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'map.get', { workspaceId: 'ws-1' });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'map.classify', {
      workspaceId: 'ws-1',
      paths: ['src/a.ts'],
    });
  });

  it('maps map.activity filters exactly', async () => {
    mockedRequest.mockResolvedValueOnce(SEMANTIC_MAP_FIXTURE_ACTIVITIES);
    const client = new SemanticMapClient();

    await expect(
      client.activity('ws-1', {
        sinceTs: '2026-09-06T02:00:00.000Z',
        minutesAgo: 10,
        agentId: 'agent-1',
        kinds: ['read', 'edit'],
        limit: 100,
      }),
    ).resolves.toBe(SEMANTIC_MAP_FIXTURE_ACTIVITIES);
    expect(mockedRequest).toHaveBeenCalledWith('map.activity', {
      workspaceId: 'ws-1',
      sinceTs: '2026-09-06T02:00:00.000Z',
      minutesAgo: 10,
      agentId: 'agent-1',
      kinds: ['read', 'edit'],
      limit: 100,
    });
  });

  it('maps either route subject and its time bound', async () => {
    mockedRequest.mockResolvedValue(SEMANTIC_MAP_FIXTURE_ROUTE);
    const client = new SemanticMapClient();

    await expect(client.route('ws-1', { agentId: 'agent-1' })).resolves.toBe(
      SEMANTIC_MAP_FIXTURE_ROUTE,
    );
    await client.route('ws-1', {
      taskNoteId: 'task-1',
      sinceTs: '2026-09-06T02:00:00.000Z',
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'map.route', {
      workspaceId: 'ws-1',
      agentId: 'agent-1',
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'map.route', {
      workspaceId: 'ws-1',
      taskNoteId: 'task-1',
      sinceTs: '2026-09-06T02:00:00.000Z',
    });
  });
});
