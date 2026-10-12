import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatch = vi.hoisted(() => vi.fn());

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch });
});

import { applyNoteFromEvent, ensureNoteContentLoaded } from './notes-read-service';

describe('notes read compatibility façade', () => {
  beforeEach(() => dispatch.mockReset());

  it('routes note events to the registered saga owner', () => {
    applyNoteFromEvent('ws-1', 'note-1', 'note:updated');
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'workspaceNotes/noteEventReceived',
      payload: ['ws-1', 'note-1', 'note:updated'],
    });
  });

  it('returns the correlated content-load outcome', async () => {
    dispatch.mockImplementation((action) => action?.success?.(true));
    await expect(ensureNoteContentLoaded('ws-1', 'note-1')).resolves.toBe(true);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      asyncActionType: 'workspaceNotes/ensureNoteContentLoadedRequested',
      payload: ['ws-1', 'note-1'],
    });
  });
});
