import { describe, expect, it } from 'vitest';
import { resolveStart, type ResolveStartInput } from './index';

describe('resolveStart', () => {
  it.each([
    ['repo URL', { text: 'https://github.com/intent-hq/intent' }, 'intent-hq', 'intent'],
    [
      'repo URL punctuation',
      { text: 'https://github.com/intent-hq/intent.' },
      'intent-hq',
      'intent',
    ],
    ['owner/name', { text: 'intent-hq/intent' }, 'intent-hq', 'intent'],
  ] satisfies Array<[string, ResolveStartInput, string, string]>)(
    '%s',
    (_name, input, owner, name) => {
      expect(resolveStart(input)).toMatchObject({
        intentText: '',
        source: { kind: 'github', owner, name, url: `https://github.com/${owner}/${name}` },
        contextLinks: [],
        unresolved: [],
      });
    },
  );

  it.each([
    ['issue', 'https://github.com/intent-hq/intent/issues/4401', 'issue'],
    ['PR', 'https://github.com/intent-hq/intent/pull/42/files', 'pr'],
  ] as const)('extracts a GitHub %s as context and source', (_name, url, kind) => {
    expect(resolveStart({ text: url })).toEqual({
      intentText: '',
      source: {
        kind: 'github',
        url: 'https://github.com/intent-hq/intent',
        owner: 'intent-hq',
        name: 'intent',
      },
      contextLinks: [
        { kind, url, owner: 'intent-hq', repo: 'intent', number: kind === 'issue' ? 4401 : 42 },
      ],
      unresolved: [],
    });
  });

  it.each([
    ['/home/user/intent', '/home/user/intent'],
    ['C:\\Users\\Ada\\intent', 'C:\\Users\\Ada\\intent'],
    ['file:///home/user/Intent%20App', '/home/user/Intent App'],
    ['file:///C:/Users/Ada/intent', 'C:/Users/Ada/intent'],
  ])('resolves local input %s without probing git', (text, path) => {
    expect(resolveStart({ text })).toEqual({
      intentText: '',
      source: { kind: 'local', path, isolation: 'worktree' },
      contextLinks: [],
      unresolved: [{ value: text, kind: 'path', reason: 'needs-git-init', needsGitInit: true }],
    });
  });

  it('retains mixed task text while extracting multiple same-repo links', () => {
    const text =
      'Fix https://github.com/intent-hq/intent/issues/1, then verify https://github.com/intent-hq/intent/pull/2.';
    const result = resolveStart({ text });
    expect(result.intentText).toBe(text);
    expect(result.source).toMatchObject({ kind: 'github', owner: 'intent-hq', name: 'intent' });
    expect(result.contextLinks).toEqual([
      {
        kind: 'issue',
        url: 'https://github.com/intent-hq/intent/issues/1',
        owner: 'intent-hq',
        repo: 'intent',
        number: 1,
      },
      {
        kind: 'pr',
        url: 'https://github.com/intent-hq/intent/pull/2',
        owner: 'intent-hq',
        repo: 'intent',
        number: 2,
      },
    ]);
  });

  it('does not guess between links to different repositories', () => {
    const result = resolveStart({
      text: 'Compare https://github.com/intent-hq/intent/issues/1 and https://github.com/intent-hq/intentd/issues/2',
    });
    expect(result.source).toBeUndefined();
    expect(result.contextLinks).toHaveLength(2);
    expect(result.unresolved).toEqual([
      {
        value: 'https://github.com/intent-hq/intent/issues/1',
        kind: 'source',
        reason: 'ambiguous-source',
      },
      {
        value: 'https://github.com/intent-hq/intentd/issues/2',
        kind: 'source',
        reason: 'ambiguous-source',
      },
    ]);
  });

  it('retains unknown links without inferring a repository', () => {
    const text = 'Investigate https://example.com/acme/repo.';
    expect(resolveStart({ text })).toEqual({
      intentText: text,
      contextLinks: [],
      unresolved: [
        { value: 'https://example.com/acme/repo', kind: 'link', reason: 'unknown-link' },
      ],
    });
  });

  it('retains plain task text even when a dropped path selects the source', () => {
    expect(
      resolveStart({ text: 'Fix the flaky tests', droppedPaths: ['/home/ada/intent'] }),
    ).toMatchObject({
      intentText: 'Fix the flaky tests',
      source: { kind: 'local', path: '/home/ada/intent' },
    });
    const unknownLink = resolveStart({ text: 'https://example.com/acme/repo' });
    expect(unknownLink).toMatchObject({
      intentText: 'https://example.com/acme/repo',
    });
    expect(unknownLink).not.toHaveProperty('source');
  });

  it('rejects renderer paths for a remote daemon', () => {
    expect(
      resolveStart({ droppedPaths: ['/Users/ada/intent'], prefill: { isRemoteDaemon: true } }),
    ).toEqual({
      intentText: '',
      contextLinks: [],
      unresolved: [
        {
          value: '/Users/ada/intent',
          kind: 'path',
          reason: 'remote-daemon-path',
          rejectedForRemoteDaemon: true,
        },
      ],
    });
  });

  it('rejects local repo prefill for a remote daemon', () => {
    expect(
      resolveStart({ prefill: { repoPath: '/Users/ada/project', isRemoteDaemon: true } }),
    ).toEqual({
      intentText: '',
      contextLinks: [],
      unresolved: [
        {
          value: '/Users/ada/project',
          kind: 'path',
          reason: 'remote-daemon-path',
          rejectedForRemoteDaemon: true,
        },
      ],
    });
  });

  it('uses existing local, GitHub issue, and new-folder prefill shapes', () => {
    expect(resolveStart({ prefill: { repoPath: '/daemon/repo', prompt: 'Fix it' } })).toMatchObject(
      {
        intentText: 'Fix it',
        source: { kind: 'local', path: '/daemon/repo' },
      },
    );
    expect(
      resolveStart({
        prefill: {
          owner: 'intent-hq',
          repo: 'intent',
          number: 4401,
          kind: 'issue',
          url: 'https://github.com/intent-hq/intent/issues/4401',
        },
      }),
    ).toMatchObject({
      source: { kind: 'github', owner: 'intent-hq', name: 'intent' },
      contextLinks: [{ kind: 'issue', number: 4401 }],
    });
    expect(
      resolveStart({ prefill: { projectName: 'new-app', parentPath: '/home/ada/Developer' } }),
    ).toMatchObject({
      source: { kind: 'newFolder', parentPath: '/home/ada/Developer', name: 'new-app' },
    });
  });

  it('returns an empty result for empty input', () => {
    expect(resolveStart({})).toEqual({ intentText: '', contextLinks: [], unresolved: [] });
  });
});
