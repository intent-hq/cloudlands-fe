import { describe, expect, it } from 'vitest';
import { discussionAgentIds, reconcileDiscussionAgentMentions } from './discussion-agent-mentions';

const mention = { agentId: 'agent-a', name: 'Reviewer', start: 3, end: 12 };
const body = 'Hi @Reviewer check this';

describe('explicit discussion agent selections', () => {
  it('preserves selected tokens through surrounding edits', () => {
    expect(reconcileDiscussionAgentMentions(body, `Please ${body}`, [mention])).toEqual([
      { ...mention, start: 10, end: 19 },
    ]);
    expect(reconcileDiscussionAgentMentions(body, `${body}!`, [mention])).toEqual([mention]);
  });
  it('drops delivery when the selected token is edited or removed', () => {
    expect(reconcileDiscussionAgentMentions(body, 'Hi @Review check this', [mention])).toEqual([]);
    expect(reconcileDiscussionAgentMentions(body, 'Hi  check this', [mention])).toEqual([]);
    expect(reconcileDiscussionAgentMentions(body, '', [mention])).toEqual([]);
    expect(
      reconcileDiscussionAgentMentions(body, 'Hi @ReviewerExtra check this', [mention]),
    ).toEqual([]);
  });
  it('never creates recipients from typed, pasted, or restored text', () => {
    expect(reconcileDiscussionAgentMentions('', body, [])).toEqual([]);
    const removed = reconcileDiscussionAgentMentions(body, '', [mention]);
    expect(reconcileDiscussionAgentMentions('', body, removed)).toEqual([]);
    expect(
      reconcileDiscussionAgentMentions('@Reviewer @Reviewer ', '@Reviewer ', [
        { ...mention, start: 0, end: 9 },
      ]),
    ).toEqual([]);
  });
  it('deduplicates and orders selected IDs independently of identical names', () => {
    expect(discussionAgentIds([mention, { ...mention, agentId: 'agent-b' }, mention])).toEqual([
      'agent-a',
      'agent-b',
    ]);
  });
});
