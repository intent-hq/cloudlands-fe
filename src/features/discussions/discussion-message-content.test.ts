import { describe, expect, it } from 'vitest';
import {
  discussionMessageMarkdown,
  discussionMessageParts,
  discussionReplyFirstLine,
} from './discussion-message-content';
const mention = { agentId: 'agent-1', name: 'Developer', start: 3, end: 13 };
describe('discussion message presentation content', () => {
  it('renders only the explicit immutable mention span, leaving matching plain text alone', () => {
    const parts = discussionMessageParts('Hi @Developer and @Developer', 'ws', [mention]);
    expect(parts).toEqual(['Hi ', { ...mention, kind: 'mention' }, ' and @Developer']);
  });
  it('keeps snapshot names and UTF-16 offsets without consulting the agent directory', () => {
    const selected = { ...mention, name: 'Old name', start: 3, end: 12 };
    expect(discussionMessageParts('👋 @Old name!', 'ws', [selected])).toEqual([
      '👋 ',
      { ...selected, kind: 'mention' },
      '!',
    ]);
  });
  it.each([
    { start: -1 },
    { start: 2.5 },
    { end: 300 },
    { end: 14 },
    { name: 'Renamed' },
    { agentId: '../other' },
    { name: 'Developer\n' },
  ])('leaves malformed/stale mention metadata as plain text: %j', (change) => {
    expect(discussionMessageParts('Hi @Developer!', 'ws', [{ ...mention, ...change }])).toEqual([
      'Hi @Developer!',
    ]);
  });
  it('does not split a larger name or render duplicate overlapping spans', () => {
    expect(discussionMessageParts('Hi @DeveloperExtra', 'ws', [mention])).toEqual([
      'Hi @DeveloperExtra',
    ]);
    expect(discussionMessageParts('Hi @Developer!', 'ws', [mention, mention])).toHaveLength(3);
  });
  it('retains only canonical workspace references as navigable chips', () => {
    const body =
      'Read [file](intent://local/ws/file/src/main.ts) and [wrong](intent://local/other/agent/a).';
    expect(discussionMessageParts(body, 'ws')).toEqual([
      'Read ',
      { kind: 'file', label: 'file', url: 'intent://local/ws/file/src/main.ts' },
      ' and [wrong](intent://local/other/agent/a).',
    ]);
  });
  it.each([
    '`[source](intent://local/ws/file/src/main.ts)`',
    '```md\n[source](intent://local/ws/file/src/main.ts)\n```',
    '- Keep `[source](intent://local/ws/file/src/main.ts)` literal.',
  ])('preserves code as code instead of turning its content into reference chips', (body) => {
    expect(discussionMessageParts(body, 'ws')).toEqual([body]);
  });
  it('escapes snapshot labels when preparing existing read-only markdown', () => {
    const part = {
      kind: 'mention' as const,
      agentId: 'agent-1',
      name: 'Dev](javascript:alert(1))',
      start: 0,
      end: 30,
    };
    expect(discussionMessageMarkdown([part], 'ws')).toBe(
      '[@Dev\\]\\(javascript:alert\\(1\\)\\)](intent://local/ws/agent/agent-1)',
    );
  });
  it('uses only the first nonempty line of an immutable reply snapshot', () => {
    expect(discussionReplyFirstLine('\n First line\r\nSecond line')).toBe('First line');
  });
});
