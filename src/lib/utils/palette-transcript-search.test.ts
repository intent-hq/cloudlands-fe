import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createTranscriptQuery } from './palette-transcript-search';

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));

const response = {
  matches: [
    {
      agentId: 'agent-1',
      messageId: 'message-1',
      workspaceId: 'tiny-owl',
      agentName: 'Coordinator',
      role: 'assistant',
      preview: 'dev con result',
      timestamp: '2026-10-01T01:00:00Z',
    },
  ],
};

describe('transcript search cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(backendRequest).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels queued and in-flight work without emitting updates, then permits a fresh search', async () => {
    const onUpdate = vi.fn();
    const controller = createTranscriptQuery(onUpdate);
    controller.query('queued', 'tiny-owl', []);
    controller.cancel();
    await vi.advanceTimersByTimeAsync(150);
    expect(backendRequest).not.toHaveBeenCalled();

    let complete!: (value: unknown) => void;
    vi.mocked(backendRequest).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    controller.query('dev con', 'tiny-owl', []);
    await vi.advanceTimersByTimeAsync(150);
    expect(backendRequest).toHaveBeenCalledExactlyOnceWith('search.messages', {
      query: 'dev con',
      limit: 10,
      preferWorkspaceId: 'tiny-owl',
    });
    onUpdate.mockClear();
    controller.cancel();
    complete(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).not.toHaveBeenCalled();

    vi.mocked(backendRequest).mockResolvedValueOnce(response);
    controller.query('fresh', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    expect(backendRequest).toHaveBeenLastCalledWith('search.messages', {
      query: 'fresh',
      limit: 10,
    });
    expect(onUpdate).toHaveBeenLastCalledWith({
      loading: false,
      items: [
        expect.objectContaining({
          id: 'agent-1:message-1',
          agentId: 'agent-1',
          messageId: 'message-1',
          workspaceId: 'tiny-owl',
          label: 'Coordinator',
          description: 'dev con result',
        }),
      ],
    });
  });
});
