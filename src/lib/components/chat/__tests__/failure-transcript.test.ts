import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { composeTranscript } from '../chat-scrollback-composition';
import { projectFailureTranscript } from '../failure-transcript';

const notice = (id: string, seq: number, appMessageId?: string): AgentMessage => ({
  id,
  seq,
  appMessageId,
  role: 'system',
  timestamp: '2026-10-07T06:00:00Z',
  contentBlocks: [{ type: 'text', text: `raw ${id}`, meta: { kind: 'turn-failure' } }],
});
const project = (history: AgentMessage[], tail: AgentMessage[], gap = false) =>
  projectFailureTranscript(composeTranscript(history, tail, gap), { agentId: 'agent', queue: [] });

describe('failure transcript projection', () => {
  it('counts overlapping paginated rows once using canonical app identity', () => {
    const result = project(
      [notice('old', 1), notice('history-copy', 2, 'same')],
      [notice('tail-copy', 2, 'same'), notice('last', 3)],
    );
    expect(result.history).toHaveLength(1);
    expect(result.history[0].records.map((r) => r.messageId)).toEqual(['old', 'tail-copy', 'last']);
    expect(result.runsByAnchor.get('old')?.recordedFailureCount).toBe(3);
    expect([...result.collapsedMessageIds]).toEqual(['tail-copy', 'last']);
  });
  it('honors an explicit history gap even when resident sequence numbers look consecutive', () => {
    const result = project([notice('history', 1)], [notice('tail', 2)], true);
    expect(result.history.map((run) => run.anchorMessageId)).toEqual(['history', 'tail']);
    expect(result.collapsedMessageIds.size).toBe(0);
  });
  it('preserves partial work and new prompts between historical runs', () => {
    const partial: AgentMessage = {
      id: 'partial',
      seq: 2,
      role: 'assistant',
      timestamp: '2026-10-07T06:00:00Z',
      contentBlocks: [{ type: 'text', text: 'Partial work' }],
    };
    const result = project([notice('first', 1), partial], [notice('second', 3)]);
    expect(result.history.map((run) => run.anchorMessageId)).toEqual(['first', 'second']);
    expect(result.collapsedMessageIds.has('partial')).toBe(false);
  });
});
