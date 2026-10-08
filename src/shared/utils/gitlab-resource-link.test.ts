import { describe, expect, it } from 'vitest';
import { parseGitLabResourceLink } from './gitlab-resource-link';
const instanceBaseUrl = 'https://git.example:8443/Forge';
const instances = [{ provider: 'gitlab', instanceBaseUrl }];
describe('configured GitLab resource URLs', () => {
  it.each(['merge_requests/12', 'merge_requests/12/diffs', 'issues/4'])(
    'retains nested project identity for %s',
    (route) => {
      const url = instanceBaseUrl + '/group/subgroup/project/-/' + route + '?view=parallel#note_7';
      expect(parseGitLabResourceLink(url, instances)).toMatchObject({
        repository: { provider: 'gitlab', instanceBaseUrl, projectPath: 'group/subgroup/project' },
        kind: route.startsWith('issues') ? 'issue' : 'merge-request',
      });
    },
  );
  it.each([
    'https://unknown.example/group/project/-/merge_requests/1',
    'https://git.example/Forge/group/project/-/merge_requests/1',
    'https://git.example:8443/forge/group/project/-/merge_requests/1',
    'https://git.example:8443/Forge/../group/project/-/merge_requests/1',
    'https://git.example:8443/Forge/group%2fproject/-/merge_requests/1',
    'https://user@git.example:8443/Forge/group/project/-/issues/1',
    'https://git.example:8443/Forge/group/project/-/work_items/1',
    'https://github.com/group/project/pull/1',
  ])('refuses unsupported or unqualified resource %s', (url) => {
    expect(parseGitLabResourceLink(url, instances)).toBeNull();
  });
});
