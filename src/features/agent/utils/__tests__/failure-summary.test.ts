import { describe, expect, it } from 'vitest';
import type { AgentMessage, QueuedMessage } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import { deriveFailureSummary } from '../failure-summary';

const timestamp = '2026-10-07T06:00:00.123456Z';
const reason = 'Provider failed';

function failure(id: string, seq: number, text = reason): AgentMessage {
  return {
    id,
    seq,
    role: 'system',
    timestamp,
    contentBlocks: [{ type: 'text', text, meta: { kind: 'turn-failure' } }],
  };
}

function queued(id: string, turnId?: string): QueuedMessage {
  return {
    id,
    turnId,
    content: 'request',
    position: 0,
    queuedAt: timestamp,
    requeuedAfterFailure: true,
  };
}

function project(overrides: Partial<Parameters<typeof deriveFailureSummary>[0]> = {}) {
  return deriveFailureSummary({ agentId: 'agent-a', messages: [], queue: [], ...overrides });
}

describe('failure presentation evidence', () => {
  it('counts a persisted notice once across replay, transient error and session error', () => {
    const notice = failure('failure-1', 1);
    const result = project({
      messages: [notice, { ...notice }],
      transientError: reason,
      session: {
        id: 'agent-a',
        status: AgentStatus.Error,
        stopReason: reason,
        stopReasonTimestamp: timestamp,
      },
    });
    expect(result.history).toHaveLength(1);
    expect(result.history[0].records.map((record) => record.messageId)).toEqual(['failure-1']);
    expect(result.current).toMatchObject({
      state: 'action-needed',
      error: reason,
      noticeId: 'failure-1',
    });
  });

  it('compacts consecutive recorded failures without claiming a shared request or total attempts', () => {
    // The second failure can precede persistence of an entirely different user request.
    const result = project({ messages: [failure('one', 1), failure('two', 2)] });
    expect(result.history).toMatchObject([
      {
        anchorMessageId: 'one',
        correlation: 'unavailable',
        recordedFailureCount: 2,
        records: [{ messageId: 'one' }, { messageId: 'two' }],
      },
    ]);
    expect(result.current.state).toBe('inactive');
    expect(result.current.noticeId).toBeUndefined();
  });

  it.each(['user', 'assistant', 'tool', 'system'] as const)(
    'keeps identical errors separated by intervening %s content',
    (role) => {
      const middle: AgentMessage = {
        id: 'middle',
        seq: 2,
        role,
        timestamp,
        isStreaming: role === 'assistant',
        contentBlocks: [{ type: 'text', text: 'Partial work or a new request' }],
      };
      const messages = [failure('one', 1), middle, failure('two', 3)];
      const before = structuredClone(messages);
      const result = project({ messages });
      expect(result.history.map((run) => run.records.map((record) => record.messageId))).toEqual([
        ['one'],
        ['two'],
      ]);
      expect(messages).toEqual(before);
    },
  );

  it('does not bridge unloaded transcript gaps or ambiguous legacy sequence numbers', () => {
    const legacy = failure('legacy', 5);
    delete legacy.seq;
    const result = project({
      messages: [failure('one', 1), failure('three', 3), legacy, failure('six', 6)],
    });
    expect(result.history.map((run) => run.recordedFailureCount)).toEqual([1, 1, 1, 1]);
  });

  it('is deterministic across reload and extends a run only when pagination fills its gap', () => {
    const latest = failure('latest', 3);
    const input = { messages: [failure('first', 1), failure('middle', 2), latest] };
    expect(project(input)).toEqual(project(JSON.parse(JSON.stringify(input))));
    expect(project({ messages: [latest] }).history[0].records).toEqual(
      project(input).history[0].records.slice(-1),
    );
  });

  it('preserves separate events with identical text and timestamps but distinct IDs', () => {
    expect(
      project({ messages: [failure('one', 1), failure('two', 2)] }).history[0].recordedFailureCount,
    ).toBe(2);
  });

  it.each([
    ['2026-10-07T06:00:00.123457Z', false],
    ['2026-10-07T08:00:00.123456000+02:00', true],
    ['invalid', false],
  ])(
    'pairs current and saved failures only with exact timestamp identity (%s)',
    (savedAt, matches) => {
      const result = project({
        messages: [failure('one', 1)],
        session: {
          id: 'agent-a',
          status: AgentStatus.Error,
          stopReason: reason,
          stopReasonTimestamp: savedAt,
        },
      });
      expect(result.current.noticeId).toBe(matches ? 'one' : undefined);
    },
  );

  it('does not attach a transient send error or an ambiguous session error to old history', () => {
    expect(
      project({ messages: [failure('one', 1)], transientError: reason }).current.noticeId,
    ).toBeUndefined();
    expect(
      project({
        messages: [failure('one', 1), failure('two', 2)],
        session: {
          id: 'agent-a',
          status: AgentStatus.Error,
          stopReason: reason,
          stopReasonTimestamp: timestamp,
        },
      }).current.noticeId,
    ).toBeUndefined();
    expect(
      project({
        messages: [failure('one', 1)],
        transientError: 'Different send failed',
        session: {
          id: 'agent-a',
          status: AgentStatus.Error,
          stopReason: reason,
          stopReasonTimestamp: timestamp,
        },
      }).current.noticeId,
    ).toBeUndefined();
  });

  it('retains a generic-error requirement when the restored error session has no reason', () => {
    expect(
      project({ session: { id: 'agent-a', status: AgentStatus.Error } }).current,
    ).toMatchObject({
      state: 'action-needed',
      error: null,
      needsFallbackReason: true,
    });
  });

  it('does not borrow a prior terminal timestamp for a different transient error', () => {
    expect(
      project({
        transientError: 'New send failed',
        session: {
          id: 'agent-a',
          status: AgentStatus.Error,
          stopReason: reason,
          stopReasonTimestamp: timestamp,
        },
      }).current.timestamp,
    ).toBeUndefined();
  });

  it('removes active failure emphasis after success without declaring old history recovered', () => {
    const result = project({
      messages: [
        failure('one', 1),
        { id: 'answer', seq: 2, role: 'assistant', timestamp, streamingComplete: true },
      ],
      session: { id: 'agent-a', status: AgentStatus.RuntimeIdle, stopReason: 'end_turn' },
    });
    expect(result.current).toMatchObject({
      state: 'inactive',
      error: null,
      needsFallbackReason: false,
    });
    expect(result.history[0].records).toHaveLength(1);
  });

  it('never imports failure state or transcript records from another agent', () => {
    const other = { ...failure('other', 1), agentId: 'agent-b' } as AgentMessage;
    expect(
      project({
        messages: [other],
        session: { id: 'agent-b', status: AgentStatus.Error, stopReason: reason },
      }),
    ).toMatchObject({ history: [], current: { state: 'inactive' } });
    expect(project({ messages: [failure('one', 1)] }).history[0].key).not.toBe(
      project({ agentId: 'agent-b', messages: [failure('one', 1)] }).history[0].key,
    );
  });
});

describe('queue recovery presentation', () => {
  it('terminal status wins over stale runtime flags', () => {
    expect(
      project({
        session: {
          id: 'agent-a',
          status: AgentStatus.Error,
          stopReason: reason,
          isResponding: true,
        },
      }).current.state,
    ).toBe('action-needed');
  });
  it('groups queue evidence by explicit turn ID and keeps legacy or unrelated requests separate', () => {
    const result = project({
      queue: [
        queued('first', 'turn-a'),
        queued('retry', 'turn-a'),
        queued('other', 'turn-b'),
        queued('legacy'),
      ],
    });
    expect(result.queueRecovery.map((group) => group.queueIds)).toEqual([
      ['first', 'retry'],
      ['other'],
      ['legacy'],
    ]);
    expect(result.queueRecovery.map((group) => group.correlation)).toEqual([
      'turn',
      'turn',
      'queue-entry',
    ]);
    expect(result.current.state).toBe('queued');
    expect(result.current.noticeId).toBeUndefined();
  });

  it('does not treat queue membership, hold expiry, or requeue markers as an active retry', () => {
    const held = {
      ...queued('held', 'turn'),
      holdKind: 'retry',
      holdUntil: '2020-01-01T00:00:00Z',
      editing: true,
    };
    const queue = [held];
    const before = structuredClone(queue);
    const result = project({
      queue,
      session: { id: 'agent-a', status: AgentStatus.Error, stopReason: reason },
    });
    expect(result.current.state).toBe('queued');
    expect(result.queueRecovery[0].state).toBe('queued');
    expect(queue).toEqual(before);
  });

  it('shows an active attempt without attributing unrelated waiting queue entries to it', () => {
    const result = project({
      queue: [queued('later', 'other')],
      session: { id: 'agent-a', status: AgentStatus.Active, turnInFlight: true },
    });
    expect(result.current.state).toBe('attempting');
    expect(result.queueRecovery[0].state).toBe('queued');
  });

  it('ordinary queue entries do not create failure evidence', () => {
    expect(
      project({ queue: [{ ...queued('normal'), requeuedAfterFailure: undefined }] }),
    ).toMatchObject({
      history: [],
      queueRecovery: [],
      current: { state: 'inactive' },
    });
  });
});
