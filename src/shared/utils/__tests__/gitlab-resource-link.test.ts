import { describe, expect, it } from 'vitest';
import { isGitLabResourceCandidate, parseGitLabResourceLink } from '../gitlab-resource-link';

const root = 'https://gitlab.example.test:8443/forge';
const instances = [{ provider: 'gitlab', instanceBaseUrl: root }];
describe('configured GitLab URL routing', () => {
  it.each([
    ['merge_requests', 'merge-request'],
    ['issues', 'issue'],
  ])('preserves the nested project and %s identity', (route, kind) => {
    const url = `${root}/Team/Platform/api/-/${route}/42?view=parallel#note_8`;
    expect(parseGitLabResourceLink(url, instances)).toEqual({
      repository: { provider: 'gitlab', instanceBaseUrl: root, projectPath: 'Team/Platform/api' },
      kind,
      number: 42,
    });
    expect(url).toContain('?view=parallel#note_8');
  });
  it.each(['diffs', 'commits', 'pipelines'])('allows only the known MR subpage %s', (page) => {
    expect(
      parseGitLabResourceLink(`${root}/a/b/-/merge_requests/42/${page}`, instances)?.kind,
    ).toBe('merge-request');
  });
  it.each([
    'https://gitlab.example.test/forge/a/b/-/issues/42',
    'https://gitlab.example.test:8443/forge-other/a/b/-/issues/42',
    'https://gitlab.example.test:8443/Forge/a/b/-/issues/42',
    'https://foreign.example/forge/a/b/-/issues/42',
    `${root}/a/b/-/work_items/42`,
    `${root}/groups/a/-/issues/42`,
    `${root}/a/b/-/issues/42/diffs`,
    `${root}/a/b/-/merge_requests/42/diffs/extra`,
    `${root}/a/b/-/issues/0`,
    `${root}/a/b/-/issues/01`,
    `${root}/a/b/-/issues/9007199254740992`,
    `${root}/a/../b/c/-/issues/42`,
    `${root}/a/%2e%2e/b/-/issues/42`,
    `${root}/a%2Fb/c/-/issues/42`,
    `${root}/a%252Fb/c/-/issues/42`,
    `${root}/a//b/-/issues/42`,
    `${root}/a/b/-/issues/42\n`,
    'https://user@gitlab.example.test:8443/forge/a/b/-/issues/42',
    'http://gitlab.example.test:8443/forge/a/b/-/issues/42',
  ])('does not route %s', (url) => expect(parseGitLabResourceLink(url, instances)).toBeNull());
  it('does not guess between conflicting installation boundaries, in either order', () => {
    const conflicting = [
      ...instances,
      { provider: 'gitlab', instanceBaseUrl: 'https://gitlab.example.test:8443' },
    ];
    const url = `${root}/a/b/-/issues/42`;
    expect(parseGitLabResourceLink(url, conflicting)).toBeNull();
    expect(parseGitLabResourceLink(url, conflicting.reverse())).toBeNull();
    expect(parseGitLabResourceLink(url, [...instances, ...instances])).not.toBeNull();
  });
  it('does not use an encoded or malformed configured root', () => {
    expect(
      parseGitLabResourceLink(`${root}/a/b/-/issues/42`, [
        { provider: 'gitlab', instanceBaseUrl: 'https://gitlab.example.test:8443/%66orge' },
      ]),
    ).toBeNull();
  });
  it.each(['https://example.com/', `${root}/a/b/-/work_items/42`, `${root}/a/b/-/issues/0`])(
    'does not even capture a descriptor for unsupported syntax %s',
    (url) => {
      expect(isGitLabResourceCandidate(url)).toBe(false);
    },
  );
});
