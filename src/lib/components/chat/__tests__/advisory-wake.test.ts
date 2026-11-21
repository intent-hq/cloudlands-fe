import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { advisoryActivityLabel, advisoryStatusLabel, readAdvisoryWake } from '../advisory-wake';
import { advisoryFoldKey, foldRepeatedAdvisoryTurns } from '../advisory-folding';
import { groupIntoTurns } from '../conversation-turns';

const pr = (prNumber: unknown, repo = 'acme/app') => ({
  monitorId: `m-${String(prNumber)}-${repo}`,
  repo,
  prNumber,
});

function advisoryMetadata(
  waiting: Record<string, unknown> = {},
  agentId: string | undefined = 'agent-a',
  overrides: Record<string, unknown> = {},
) {
  return {
    type: 'event_notification',
    eventCount: 1,
    eventTypes: ['agent:idle'],
    watchStillArmed: true,
    childExternallyWaiting: true,
    ...waiting,
    events: [
      {
        type: 'agent:idle',
        timestamp: '2026-11-20T22:20:00.000Z',
        data: { agentId, agentName: 'Builder', status: 'idle' },
      },
    ],
    ...overrides,
  };
}

let nextId = 0;
const wake = (metadata: Record<string, unknown>, id = `wake-${++nextId}`): AgentMessage =>
  ({ id, role: 'user', contentBlocks: [], metadata }) as unknown as AgentMessage;
const reply = (id = `reply-${++nextId}`): AgentMessage =>
  ({
    id,
    role: 'assistant',
    contentBlocks: [{ type: 'text', text: 'Still waiting.' }],
  }) as AgentMessage;
const twoPrs = { waitingOnPrMonitors: [pr(779), pr(797)] };

function fold(messages: AgentMessage[], keepMessageId?: string | null) {
  return foldRepeatedAdvisoryTurns(groupIntoTurns(messages), keepMessageId).map((turn) => ({
    id: turn.userMessage?.id ?? turn.bodyMessages[0]?.id,
    folded: (turn.foldedMessages ?? []).map((message) => message.id),
  }));
}

describe('readAdvisoryWake', () => {
  it('reads only an explicit boolean true flag', () => {
    expect(readAdvisoryWake(advisoryMetadata())).not.toBeNull();
    expect(readAdvisoryWake({ ...advisoryMetadata(), childExternallyWaiting: false })).toBeNull();
    expect(readAdvisoryWake({ ...advisoryMetadata(), childExternallyWaiting: 'true' })).toBeNull();
    const { childExternallyWaiting: _omit, ...genuine } = advisoryMetadata();
    expect(readAdvisoryWake(genuine)).toBeNull();
    expect(readAdvisoryWake(null)).toBeNull();
    expect(readAdvisoryWake('event_notification')).toBeNull();
  });

  it('ignores malformed PR data instead of printing it', () => {
    for (const waitingOnPrMonitors of [
      undefined,
      null,
      'pr',
      {},
      [null, 'x', {}, pr('779'), pr(0), pr(-3), pr(1.5), pr(Number.NaN)],
    ]) {
      const wakeInfo = readAdvisoryWake(advisoryMetadata({ waitingOnPrMonitors }));
      expect(wakeInfo?.refs).toEqual([]);
    }
  });

  it('dedupes repeated PRs, sorts by number, and qualifies numbers shared across repos', () => {
    expect(
      readAdvisoryWake(advisoryMetadata({ waitingOnPrMonitors: [pr(797), pr(779), pr(797)] }))
        ?.refs,
    ).toEqual(['#779', '#797']);
    expect(
      readAdvisoryWake(
        advisoryMetadata({
          waitingOnPrMonitors: [pr(5, 'acme/web'), pr(5, 'acme/app'), pr(9, 'acme/app')],
        }),
      )?.refs,
    ).toEqual(['acme/app#5', 'acme/web#5', '#9']);
  });
});

describe('advisory labels', () => {
  const label = (waiting: Record<string, unknown>) => {
    const info = readAdvisoryWake(advisoryMetadata(waiting));
    if (!info) throw new Error('expected an advisory');
    return { full: advisoryActivityLabel('Builder', info), status: advisoryStatusLabel(info) };
  };

  it('names one PR', () => {
    expect(label({ waitingOnPrMonitors: [pr(779)] })).toEqual({
      full: 'Builder is waiting on PR #779',
      status: 'is waiting on PR #779',
    });
  });

  it('lists two PRs with the locale list format', () => {
    expect(label(twoPrs)).toEqual({
      full: 'Builder is waiting on PRs #779 and #797',
      status: 'is waiting on PRs #779 and #797',
    });
  });

  it('counts three or more PRs', () => {
    expect(label({ waitingOnPrMonitors: [pr(1), pr(2), pr(3), pr(4)] })).toEqual({
      full: 'Builder is waiting on 4 PRs',
      status: 'is waiting on 4 PRs',
    });
  });

  it('says only waiting for hooks, script monitors, or no named wait', () => {
    for (const waiting of [
      { waitingOnHooks: [{ hookId: 'h', name: 'Deploy' }] },
      { waitingOnScriptMonitors: [{ scriptName: 'e2e', runId: 'r' }] },
      {},
    ]) {
      expect(label(waiting)).toEqual({ full: 'Builder is waiting', status: 'is waiting' });
    }
  });
});

describe('advisoryFoldKey', () => {
  it('keys advisories by agent and visible label', () => {
    const key = advisoryFoldKey(wake(advisoryMetadata(twoPrs)));
    expect(key).toBeTruthy();
    expect(
      advisoryFoldKey(wake(advisoryMetadata({ waitingOnPrMonitors: [pr(797), pr(779)] }))),
    ).toBe(key);
    expect(advisoryFoldKey(wake(advisoryMetadata(twoPrs, 'agent-b')))).not.toBe(key);
    expect(advisoryFoldKey(wake(advisoryMetadata({ waitingOnPrMonitors: [pr(779)] })))).not.toBe(
      key,
    );
    expect(
      advisoryFoldKey(wake(advisoryMetadata({ waitingOnPrMonitors: [pr(1), pr(2), pr(3)] }))),
    ).toBe(advisoryFoldKey(wake(advisoryMetadata({ waitingOnPrMonitors: [pr(4), pr(5), pr(6)] }))));
  });

  it('never keys completions, unknown agents, or multi-event wakes', () => {
    const { childExternallyWaiting: _omit, ...genuine } = advisoryMetadata();
    expect(advisoryFoldKey(wake(genuine))).toBeNull();
    expect(
      advisoryFoldKey(
        wake(
          advisoryMetadata({}, 'agent-a', {
            events: [{ type: 'agent:idle', data: {}, timestamp: '' }],
          }),
        ),
      ),
    ).toBeNull();
    expect(advisoryFoldKey(wake(advisoryMetadata({}, '')))).toBeNull();
    expect(advisoryFoldKey(wake(advisoryMetadata({}, 'agent-a', { eventCount: 2 })))).toBeNull();
    expect(
      advisoryFoldKey(
        wake(
          advisoryMetadata({}, 'agent-a', {
            events: [{ type: 'agent:failed', data: { agentId: 'agent-a' }, timestamp: '' }],
          }),
        ),
      ),
    ).toBeNull();
    expect(advisoryFoldKey(reply())).toBeNull();
    expect(advisoryFoldKey(null)).toBeNull();
  });
});

describe('foldRepeatedAdvisoryTurns', () => {
  it('folds a back-to-back run into one row that keeps the latest', () => {
    const run = Array.from({ length: 5 }, (_, index) =>
      wake(advisoryMetadata(twoPrs), `run-${index}`),
    );
    expect(fold(run)).toEqual([{ id: 'run-4', folded: ['run-0', 'run-1', 'run-2', 'run-3'] }]);
  });

  it('keeps different agents and different labels apart', () => {
    const a = advisoryMetadata(twoPrs, 'agent-a');
    const b = advisoryMetadata(twoPrs, 'agent-b');
    expect(fold([wake(a, '1'), wake(b, '2'), wake(a, '3'), wake(b, '4')])).toEqual([
      { id: '1', folded: [] },
      { id: '2', folded: [] },
      { id: '3', folded: [] },
      { id: '4', folded: [] },
    ]);
    expect(
      fold([
        wake(advisoryMetadata({ waitingOnPrMonitors: [pr(779)] }), '1'),
        wake(advisoryMetadata(twoPrs), '2'),
      ]),
    ).toEqual([
      { id: '1', folded: [] },
      { id: '2', folded: [] },
    ]);
  });

  it('never folds across a completion, a reply, or a notice', () => {
    const { childExternallyWaiting: _omit, ...genuine } = advisoryMetadata(twoPrs);
    expect(
      fold([
        wake(advisoryMetadata(twoPrs), '1'),
        wake(genuine, 'done'),
        wake(advisoryMetadata(twoPrs), '2'),
        reply('r'),
        wake(advisoryMetadata(twoPrs), '3'),
      ]),
    ).toEqual([
      { id: '1', folded: [] },
      { id: 'done', folded: [] },
      { id: '2', folded: [] },
      { id: '3', folded: [] },
    ]);
    const notice = {
      id: 'notice',
      role: 'system',
      contentBlocks: [{ type: 'text', text: 'Model changed' }],
      metadata: { type: 'model_changed' },
    } as unknown as AgentMessage;
    expect(
      fold([wake(advisoryMetadata(twoPrs), '1'), notice, wake(advisoryMetadata(twoPrs), '2')]),
    ).toEqual([
      { id: '1', folded: [] },
      { id: '2', folded: [] },
    ]);
  });

  it('keeps the new-messages anchor row so the divider stays between old and new', () => {
    const run = ['1', '2', '3', '4'].map((id) => wake(advisoryMetadata(twoPrs), id));
    expect(fold(run, '2')).toEqual([
      { id: '2', folded: ['1'] },
      { id: '4', folded: ['3'] },
    ]);
  });

  it('keeps the latest response and its notices after folding earlier empty turns', () => {
    const messages = [
      wake(advisoryMetadata(twoPrs), '1'),
      wake(advisoryMetadata(twoPrs), '2'),
      reply('r'),
    ];
    const [turn] = foldRepeatedAdvisoryTurns(groupIntoTurns(messages));
    expect(turn.userMessage?.id).toBe('2');
    expect(turn.foldedMessages?.map(({ id }) => id)).toEqual(['1']);
    expect(turn.bodyMessages.map(({ id }) => id)).toEqual(['r']);
    expect(turn.assistantMessages.map(({ id }) => id)).toEqual(['r']);
  });

  it('does not fold across inline system notices', () => {
    const notice = {
      id: 'notice',
      role: 'system',
      metadata: { type: 'provider_failover' },
      contentBlocks: [{ type: 'text', text: 'Switching provider' }],
    } as unknown as AgentMessage;
    expect(
      fold([wake(advisoryMetadata(twoPrs), '1'), notice, wake(advisoryMetadata(twoPrs), '2')]),
    ).toEqual([
      { id: '1', folded: [] },
      { id: '2', folded: [] },
    ]);
  });
});
