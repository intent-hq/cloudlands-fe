import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { loadPreviousUserMessage, type PreviousMessagePage } from '../previous-user-message-page';

function msg(
  id: string,
  role: AgentMessage['role'] = 'assistant',
  metadata?: AgentMessage['metadata'],
): AgentMessage {
  return {
    id,
    role,
    metadata,
    timestamp: '2026-09-29T00:00:00Z',
    contentBlocks: [{ type: 'text', text: id }],
  };
}
function page(messages: AgentMessage[], nextToken: string | null = null): PreviousMessagePage {
  return { messages, nextToken, prevToken: 'forward', totalMessages: 1000 };
}

describe('loadPreviousUserMessage', () => {
  it('anchors at the clicked row, skips automated pages, and picks the nearest human', async () => {
    const target = msg('near', 'user', { type: 'question_answers' });
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          [msg('wake', 'user', { type: 'hook_wake' }), msg('clicked'), msg('later', 'user')],
          'older-1',
        ),
      )
      .mockResolvedValueOnce(page([msg('system', 'user', { source: 'system' })], 'older-2'))
      .mockResolvedValueOnce(
        page(
          [msg('far', 'user'), target, msg('agent', 'user', { fromAgentId: 'agent-2' })],
          'older-3',
        ),
      );
    const result = await loadPreviousUserMessage('clicked', fetchPage, () => true);
    expect(result?.target).toEqual(target);
    expect(fetchPage.mock.calls).toEqual([
      [undefined, 'clicked'],
      ['older-1', undefined],
      ['older-2', undefined],
    ]);
    expect(result?.page.nextToken).toBe('older-3');
  });

  it('only permits top fallback after the backward cursor reaches the start', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([msg('clicked')], 'older'))
      .mockResolvedValueOnce(page([msg('first')], null));
    expect((await loadPreviousUserMessage('clicked', fetchPage, () => true))?.target).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing anchor instead of picking a potentially newer human', async () => {
    await expect(
      loadPreviousUserMessage(
        'deleted',
        async () => page([msg('unrelated', 'user')]),
        () => true,
      ),
    ).rejects.toThrow('anchor');
  });

  it('rejects repeated cursors instead of looping or claiming conversation start', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([msg('clicked')], 'repeat'))
      .mockResolvedValue(page([], 'repeat'));
    await expect(loadPreviousUserMessage('clicked', fetchPage, () => true)).rejects.toThrow(
      'cursor',
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('deduplicates overlapping pages including aliases of the clicked user', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        page([{ ...msg('clicked', 'user'), appMessageId: 'app-clicked' }], 'older'),
      )
      .mockResolvedValueOnce(
        page([msg('human', 'user'), { ...msg('alias', 'user'), appMessageId: 'app-clicked' }]),
      );
    expect((await loadPreviousUserMessage('clicked', fetchPage, () => true))?.target?.id).toBe(
      'human',
    );
  });

  it('propagates loading failures without returning a false top fallback', async () => {
    await expect(
      loadPreviousUserMessage(
        'clicked',
        async () => {
          throw new Error('offline');
        },
        () => true,
      ),
    ).rejects.toThrow('offline');
  });

  it('drops a cancelled response without fetching another page', async () => {
    let current = true;
    const fetchPage = vi.fn(async () => {
      current = false;
      return page([msg('human', 'user'), msg('clicked')], 'older');
    });
    expect(await loadPreviousUserMessage('clicked', fetchPage, () => current)).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when already cancelled', async () => {
    const fetchPage = vi.fn();
    expect(await loadPreviousUserMessage('clicked', fetchPage, () => false)).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
