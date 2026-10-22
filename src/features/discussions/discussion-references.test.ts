import { describe, expect, it } from 'vitest';
import {
  discussionBodyParts,
  discussionCandidateReference,
  discussionReferenceMarkdown,
  parseDiscussionReference,
} from './discussion-references';

describe('discussion references', () => {
  it('preserves ordinary text and renders only supported reference links', () => {
    expect(
      discussionBodyParts(
        'See [Astra](intent://local/ws/agent/agent-1), [#84](https://github.com/intent-hq/intent/pull/84), and [the file](intent://local/file/src/a.ts).',
        'ws',
      ),
    ).toEqual([
      'See ',
      { kind: 'agent', label: 'Astra', url: 'intent://local/ws/agent/agent-1', agentId: 'agent-1' },
      ', ',
      { kind: 'pr', label: '#84', url: 'https://github.com/intent-hq/intent/pull/84' },
      ', and ',
      { kind: 'file', label: 'the file', url: 'intent://local/file/src/a.ts' },
      '.',
    ]);
    const plain = '<img src=x onerror=alert(1)> [click](javascript:alert(1))';
    expect(discussionBodyParts(plain, 'ws')).toEqual([plain]);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///etc/passwd',
    'intent://evil/ws/file/src/a.ts',
    'intent://local/other/agent/agent-1',
    'intent://local/other/file/src/a.ts',
    'intent://local/file/../secret',
    'intent://local/file/%2e%2e/secret',
    'intent://local/file/src%2fsecret',
    'intent://local/file/src%5csecret',
    'intent://local/file/%00name',
    'intent://local/file/%ZZ',
    'intent://local/file//etc/passwd',
    'https://github.com@evil.test/a/b/pull/1',
    'https://github.com.evil.test/a/b/pull/1',
    'https://github.com/../repo/pull/1',
    'https://github.com/owner/../pull/1',
    'https://github.com/a/b/pull/0',
    'https://github.com/a/b/pull/1?redirect=evil',
  ])('leaves unsafe or foreign target as text: %s', (url) => {
    expect(parseDiscussionReference(url, 'target', 'ws')).toBeNull();
    expect(discussionBodyParts(`[target](${url})`, 'ws')).toEqual([`[target](${url})`]);
  });
  it('encodes literal filename punctuation and keeps generated references parseable', () => {
    const reference = discussionCandidateReference(
      {
        id: 'file-1',
        type: 'file',
        label: 'file [one]',
        uri: '',
        meta: { path: 'docs/My file (#1)%.md' },
      },
      'ws',
    );
    expect(reference?.url).toBe('intent://local/ws/file/docs/My%20file%20%28%231%29%25.md');
    const markdown = discussionReferenceMarkdown(reference!);
    expect(discussionBodyParts(markdown, 'ws')[0]).toMatchObject({
      kind: 'file',
      label: 'file  one',
    });
  });
});
