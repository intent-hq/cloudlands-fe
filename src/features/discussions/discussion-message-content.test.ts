import { describe, expect, it } from 'vitest';
import {
  discussionMessageMarkdown,
  discussionMessageParts,
  discussionReplyFirstLine,
} from './discussion-message-content';
const mention = { agentId: 'agent-1', name: 'Developer', start: 3, end: 13 };
describe('discussion message presentation content', () => {
  it('styles repeated labels while only the immutable selected span has an agent destination', () => {
    const parts = discussionMessageParts('Hi @Developer and @Developer', 'ws', [mention]);
    expect(parts).toEqual([
      'Hi ',
      { ...mention, kind: 'mention' },
      ' and ',
      { kind: 'mention', name: 'Developer', start: 18, end: 28 },
    ]);
    expect(discussionMessageMarkdown(parts, 'ws')).toBe(
      'Hi [@Developer](intent://local/ws/agent/agent-1) and @Developer',
    );
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
  ])('never turns malformed/stale metadata into an agent destination: %j', (change) => {
    expect(discussionMessageParts('Hi @Developer!', 'ws', [{ ...mention, ...change }])).toEqual([
      'Hi ',
      { kind: 'mention', name: 'Developer', start: 3, end: 13 },
      '!',
    ]);
  });
  it('does not split a larger name or render duplicate overlapping spans', () => {
    expect(discussionMessageParts('Hi @DeveloperExtra', 'ws', [mention])).toEqual([
      'Hi ',
      { kind: 'mention', name: 'DeveloperExtra', start: 3, end: 18 },
    ]);
    expect(discussionMessageParts('Hi @Developer!', 'ws', [mention, mention])).toHaveLength(3);
  });
  it('recognizes user handles and legacy agent labels without inventing recipient IDs', () => {
    const parts = discussionMessageParts('@sambreed2 hello @Developer', 'ws');
    expect(parts).toEqual([
      { kind: 'mention', name: 'sambreed2', start: 0, end: 10 },
      ' hello ',
      { kind: 'mention', name: 'Developer', start: 17, end: 27 },
    ]);
    expect(discussionMessageMarkdown(parts, 'ws')).toBe('@sambreed2 hello @Developer');
  });
  it('uses known multiword display labels without changing their spelling or granting authority', () => {
    const body = 'Thanks (@Sam Breed), @Sam and @DeveloperExtra.';
    const parts = discussionMessageParts(body, 'ws', [], ['Sam', 'Sam Breed', 'Developer']);
    expect(parts.filter((part) => typeof part !== 'string')).toEqual([
      { kind: 'mention', name: 'Sam Breed', start: 8, end: 18 },
      { kind: 'mention', name: 'Sam', start: 21, end: 25 },
      { kind: 'mention', name: 'DeveloperExtra', start: 30, end: 45 },
    ]);
    expect(discussionMessageMarkdown(parts, 'ws')).toBe(body);
  });
  it.each([
    'sam@example.com https://example.com/@sam',
    '`@Developer`',
    '```text\n@Developer\n```',
    '[@Developer](https://example.com/@sam)',
    '![hello @sam](https://example.com/image.png)',
    '<span>@Developer</span>',
  ])('preserves code, HTML, links and email addresses: %s', (body) => {
    expect(discussionMessageParts(body, 'ws')).toEqual([body]);
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
  it('leaves table code and links literal while preserving ordinary handle bytes in markdown', () => {
    const body =
      '| Example | Link |\n| --- | --- |\n| `hello @sam_name` | [@Reviewer](https://example.com) |\n\nThanks @sam_name.';
    const parts = discussionMessageParts(body, 'ws');
    expect(parts.filter((part) => typeof part !== 'string')).toEqual([
      {
        kind: 'mention',
        name: 'sam_name',
        start: body.lastIndexOf('@sam_name'),
        end: body.length - 1,
      },
    ]);
    expect(discussionMessageMarkdown(parts, 'ws')).toBe(body);
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
