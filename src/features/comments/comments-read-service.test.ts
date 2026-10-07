import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatch = vi.hoisted(() => vi.fn());

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch });
});

import { applyCommentFromEvent } from './comments-read-service';

describe('comments read compatibility façade', () => {
  beforeEach(() => dispatch.mockReset());

  it.each(['added', 'resolved'] as const)('routes %s events to the saga owner', (kind) => {
    applyCommentFromEvent('ws-1', 'note-1', kind);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'workspaceNotes/commentEventReceived',
      payload: ['ws-1', 'note-1', kind],
    });
  });
});
