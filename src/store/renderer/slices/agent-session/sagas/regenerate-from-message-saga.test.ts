import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getMessageBlock: vi.fn(), toastError: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { agents: { getMessageBlock: mocks.getMessageBlock } },
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.toastError } }));

import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  agentSessionEditAndRegenerateRequested,
  agentSessionRegenerateFromMessageRequested,
} from '../agent-session-slice';
import { regenerateFromMessageSaga } from './regenerate-from-message-saga';

const WS = 'ws-regenerate-saga';
const AGENT = 'agent-regenerate';
const messages: AgentMessage[] = [
  {
    id: 'u1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'first question' }],
    timestamp: '2026-01-01',
  } as AgentMessage,
  {
    id: 'a1',
    role: 'assistant',
    contentBlocks: [{ type: 'text', text: 'first answer' }],
    timestamp: '2026-01-02',
  } as AgentMessage,
  {
    id: 'u2',
    role: 'user',
    contentBlocks: [
      { type: 'text', text: 'look at ' },
      { type: 'text', text: 'these' },
      { type: 'image', attachmentId: 'img-ref', mimeType: 'image/png' },
      { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
      {
        type: 'file',
        attachmentId: 'file-ref',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        size: 12,
      },
    ],
    timestamp: '2026-01-03',
  } as AgentMessage,
  {
    id: 'a2',
    role: 'assistant',
    contentBlocks: [{ type: 'text', text: 'second answer' }],
    timestamp: '2026-01-04',
  } as AgentMessage,
];
const leadingAssistantOnly: AgentMessage[] = [
  {
    id: 'a0',
    role: 'assistant',
    contentBlocks: [{ type: 'text', text: 'greeting' }],
    timestamp: '2026-01-01',
  } as AgentMessage,
];

type EditAction = ReturnType<typeof agentSessionEditAndRegenerateRequested>;

function userMessageWith(blocks: ContentBlock[]): AgentMessage[] {
  return [
    {
      id: 'u9',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'see attached' }, ...blocks],
      timestamp: '2026-01-01',
    } as AgentMessage,
    {
      id: 'a9',
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: 'ok' }],
      timestamp: '2026-01-02',
    } as AgentMessage,
  ];
}

interface StartOptions {
  /** Hydrated scrollback history segment (rows older than the tail). */
  history?: AgentMessage[];
  /** The history→tail hole is open. */
  gapToTail?: boolean;
}

function start(sessionMessages: AgentMessage[] = messages, options: StartOptions = {}) {
  const channel = stdChannel();
  const dispatched: any[] = [];
  const edits: EditAction[] = [];
  const agent: AgentSession = {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: `backend-${AGENT}`,
    name: 'Agent',
    status: AgentStatus.Active,
    messages: sessionMessages,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as AgentSession;
  const historySegmentsByAgentId = options.history
    ? {
        [AGENT]: {
          messages: options.history,
          gapToTail: options.gapToTail === true,
          oldestReached: false,
        },
      }
    : undefined;
  const task = runSaga(
    {
      channel,
      getState: () => ({
        agentSessions: { byAgentId: { [AGENT]: agent }, historySegmentsByAgentId },
      }),
      dispatch: (action) => {
        dispatched.push(action);
        if (action.type === agentSessionEditAndRegenerateRequested.type) edits.push(action);
        channel.put(action);
        return action;
      },
    },
    regenerateFromMessageSaga,
  );
  return { channel, dispatched, edits, task };
}

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

describe('regenerateFromMessageSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('replays the preceding user message verbatim (text and attachment blocks) for an assistant target', async () => {
    const { channel, edits, task } = start();
    const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a2');
    channel.put(action);
    await settle();

    expect(edits).toHaveLength(1);
    expect(edits[0].payload).toEqual([
      AGENT,
      WS,
      'u2',
      'look at these',
      {
        imageBlocks: [
          { type: 'image', attachmentId: 'img-ref', mimeType: 'image/png' },
          { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
        ],
        fileBlocks: [
          {
            type: 'file',
            attachmentId: 'file-ref',
            fileName: 'notes.txt',
            mimeType: 'text/plain',
            size: 12,
          },
        ],
      },
    ]);
    edits[0].success(undefined as never);
    await expect(action.promise).resolves.toBeUndefined();
    expect(mocks.toastError).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('regenerates directly from a user target and forwards the model override', async () => {
    const { channel, edits, task } = start();
    const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'u1', { model: 'opus' });
    channel.put(action);
    await settle();

    expect(edits).toHaveLength(1);
    expect(edits[0].payload).toEqual([AGENT, WS, 'u1', 'first question', { model: 'opus' }]);
    edits[0].success(undefined as never);
    await expect(action.promise).resolves.toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('fails closed with one toast when no user message precedes the target', async () => {
    const { channel, edits, dispatched, task } = start(leadingAssistantOnly);
    const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a0');
    channel.put(action);
    await expect(action.promise).rejects.toBeInstanceOf(Error);

    expect(edits).toHaveLength(0);
    expect(dispatched.map((item) => item.type)).toEqual([action.failure(new Error('x')).type]);
    await settle();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.any(String));
    task.cancel();
    await task.toPromise();
  });

  it('fails closed with one toast when the target message is not in the session', async () => {
    const { channel, edits, dispatched, task } = start();
    const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'missing');
    channel.put(action);
    await expect(action.promise).rejects.toBeInstanceOf(Error);

    expect(edits).toHaveLength(0);
    expect(dispatched.map((item) => item.type)).toEqual([action.failure(new Error('x')).type]);
    await settle();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  describe('scrollback history rows (composed transcript)', () => {
    const historyRows: AgentMessage[] = [
      {
        id: 'h-u0',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'older question' }],
        timestamp: '2025-12-30',
      } as AgentMessage,
      {
        id: 'h-a0',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'older answer' }],
        timestamp: '2025-12-31',
      } as AgentMessage,
    ];
    const tailAssistantFirst: AgentMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'first answer' }],
        timestamp: '2026-01-02',
      } as AgentMessage,
      ...messages.slice(2),
    ];

    it('sources a hydrated history row from the history user message when the tail is contiguous', async () => {
      const { channel, edits, task } = start(messages, { history: historyRows, gapToTail: false });
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'h-a0');
      channel.put(action);
      await settle();

      expect(edits).toHaveLength(1);
      expect(edits[0].payload).toEqual([AGENT, WS, 'h-u0', 'older question', undefined]);
      edits[0].success(undefined as never);
      await expect(action.promise).resolves.toBeUndefined();
      expect(mocks.toastError).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });

    it('sources the first tail row from the history user message across a closed junction', async () => {
      const { channel, edits, task } = start(tailAssistantFirst, {
        history: historyRows,
        gapToTail: false,
      });
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a1');
      channel.put(action);
      await settle();

      expect(edits).toHaveLength(1);
      expect(edits[0].payload.slice(0, 4)).toEqual([AGENT, WS, 'h-u0', 'older question']);
      edits[0].success(undefined as never);
      await expect(action.promise).resolves.toBeUndefined();
      task.cancel();
      await task.toPromise();
    });

    it('does not double-count a row resident in both lists; the tail copy wins', async () => {
      const staleHistoryCopy: AgentMessage[] = [
        {
          id: 'u1',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'stale history copy' }],
          timestamp: '2026-01-01',
        } as AgentMessage,
        messages[1],
      ];
      const { channel, edits, task } = start(messages, {
        history: staleHistoryCopy,
        gapToTail: false,
      });
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a1');
      channel.put(action);
      await settle();

      expect(edits).toHaveLength(1);
      expect(edits[0].payload.slice(0, 4)).toEqual([AGENT, WS, 'u1', 'first question']);
      edits[0].success(undefined as never);
      await expect(action.promise).resolves.toBeUndefined();
      task.cancel();
      await task.toPromise();
    });

    it('fails closed with one toast when the walk back would cross an open history→tail gap', async () => {
      const { channel, edits, dispatched, task } = start(tailAssistantFirst, {
        history: historyRows,
        gapToTail: true,
      });
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a1');
      channel.put(action);
      await expect(action.promise).rejects.toBeInstanceOf(Error);

      expect(edits).toHaveLength(0);
      expect(dispatched.map((item) => item.type)).toEqual([action.failure(new Error('x')).type]);
      await settle();
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      task.cancel();
      await task.toPromise();
    });

    it('still sources a history row within the hydrated segment while the gap is open', async () => {
      const { channel, edits, task } = start(messages, { history: historyRows, gapToTail: true });
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'h-a0');
      channel.put(action);
      await settle();

      expect(edits).toHaveLength(1);
      expect(edits[0].payload.slice(0, 4)).toEqual([AGENT, WS, 'h-u0', 'older question']);
      edits[0].success(undefined as never);
      await expect(action.promise).resolves.toBeUndefined();
      task.cancel();
      await task.toPromise();
    });
  });

  it('rejects with the edit flow failure without toasting a second time', async () => {
    const { channel, edits, dispatched, task } = start();
    const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a1');
    channel.put(action);
    await settle();

    expect(edits[0].payload.slice(0, 4)).toEqual([AGENT, WS, 'u1', 'first question']);
    edits[0].failure(new Error('bad message'));
    await expect(action.promise).rejects.toThrow('bad message');
    expect(dispatched.at(-1).type).toBe(action.failure(new Error('x')).type);
    // The delegated edit saga owns the toast for post-put failures.
    expect(mocks.toastError).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  describe('slim-projection inline images (PROTOCOL §5.5 agent.getMessageBlock)', () => {
    const FULL = 'RkFVTExfQllURVM=';

    it('hydrates a write-time thumbnail through getMessageBlock before the edit put', async () => {
      mocks.getMessageBlock.mockResolvedValue({
        id: 'blk-thumb',
        type: 'image',
        data: FULL,
        mimeType: 'image/png',
      });
      const { channel, edits, task } = start(
        userMessageWith([
          {
            id: 'blk-thumb',
            type: 'image',
            data: 'dGh1bWI=',
            mimeType: 'image/png',
            dataTruncated: true,
            dataIsThumbnail: true,
          },
        ]),
      );
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a9');
      channel.put(action);
      await settle();

      expect(mocks.getMessageBlock).toHaveBeenCalledWith(AGENT, 'u9', 'blk-thumb');
      expect(edits).toHaveLength(1);
      expect(edits[0].payload[4]).toEqual({
        imageBlocks: [{ type: 'image', data: FULL, mimeType: 'image/png' }],
      });
      edits[0].success(undefined as never);
      await expect(action.promise).resolves.toBeUndefined();
      task.cancel();
      await task.toPromise();
    });

    it('hydrates a slim row whose data is omitted entirely', async () => {
      mocks.getMessageBlock.mockResolvedValue({
        id: 'blk-omitted',
        type: 'image',
        data: FULL,
        mimeType: 'image/webp',
      });
      const { channel, edits, task } = start(
        userMessageWith([{ id: 'blk-omitted', type: 'image', mimeType: 'image/webp' }]),
      );
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a9');
      channel.put(action);
      await settle();

      expect(mocks.getMessageBlock).toHaveBeenCalledWith(AGENT, 'u9', 'blk-omitted');
      expect(edits[0].payload[4]).toEqual({
        imageBlocks: [{ type: 'image', data: FULL, mimeType: 'image/webp' }],
      });
      edits[0].success(undefined as never);
      await expect(action.promise).resolves.toBeUndefined();
      task.cancel();
      await task.toPromise();
    });

    it('does not fetch a full-data inline image or an attachment reference', async () => {
      const { channel, edits, task } = start();
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a2');
      channel.put(action);
      await settle();

      expect(mocks.getMessageBlock).not.toHaveBeenCalled();
      expect(edits).toHaveLength(1);
      edits[0].success(undefined as never);
      await action.promise;
      task.cancel();
      await task.toPromise();
    });

    it('fails the regenerate without an edit put when getMessageBlock rejects, and toasts', async () => {
      mocks.getMessageBlock.mockRejectedValue(new Error('block gone'));
      const { channel, edits, dispatched, task } = start(
        userMessageWith([
          {
            id: 'blk-thumb',
            type: 'image',
            data: 'dGh1bWI=',
            mimeType: 'image/png',
            dataTruncated: true,
          },
        ]),
      );
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a9');
      channel.put(action);
      await expect(action.promise).rejects.toBeInstanceOf(Error);

      expect(edits).toHaveLength(0);
      expect(dispatched.map((item) => item.type)).toEqual([action.failure(new Error('x')).type]);
      await settle();
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith(expect.any(String));
      task.cancel();
      await task.toPromise();
    });

    it('fails closed on a truncated image block that carries no id, and toasts', async () => {
      const { channel, edits, task } = start(
        userMessageWith([
          { type: 'image', data: 'dGh1bWI=', mimeType: 'image/png', dataTruncated: true },
        ]),
      );
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a9');
      channel.put(action);
      await expect(action.promise).rejects.toBeInstanceOf(Error);

      expect(mocks.getMessageBlock).not.toHaveBeenCalled();
      expect(edits).toHaveLength(0);
      await settle();
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      task.cancel();
      await task.toPromise();
    });

    it('fails closed when the hydrated block still has no replayable bytes, and toasts', async () => {
      mocks.getMessageBlock.mockResolvedValue({
        id: 'blk-thumb',
        type: 'image',
        mimeType: 'image/png',
      });
      const { channel, edits, task } = start(
        userMessageWith([
          { id: 'blk-thumb', type: 'image', mimeType: 'image/png', dataTruncated: true },
        ]),
      );
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a9');
      channel.put(action);
      await expect(action.promise).rejects.toBeInstanceOf(Error);

      expect(edits).toHaveLength(0);
      await settle();
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      task.cancel();
      await task.toPromise();
    });
  });

  describe('file blocks', () => {
    it('re-sends an attachment-reference file block unchanged', async () => {
      const { channel, edits, task } = start(
        userMessageWith([{ type: 'file', attachmentId: 'f1', fileName: 'a.csv', size: 3 }]),
      );
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a9');
      channel.put(action);
      await settle();

      expect(edits[0].payload[4]).toEqual({
        fileBlocks: [{ type: 'file', attachmentId: 'f1', fileName: 'a.csv', size: 3 }],
      });
      edits[0].success(undefined as never);
      await action.promise;
      task.cancel();
      await task.toPromise();
    });

    it('fails closed on a legacy inline file block instead of dropping it, and toasts', async () => {
      const { channel, edits, dispatched, task } = start(
        userMessageWith([
          { type: 'file', data: 'aGVsbG8=', fileName: 'legacy.txt', mimeType: 'text/plain' },
        ]),
      );
      const action = agentSessionRegenerateFromMessageRequested(AGENT, WS, 'a9');
      channel.put(action);
      await expect(action.promise).rejects.toBeInstanceOf(Error);

      expect(edits).toHaveLength(0);
      expect(dispatched.map((item) => item.type)).toEqual([action.failure(new Error('x')).type]);
      await settle();
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      task.cancel();
      await task.toPromise();
    });
  });
});
