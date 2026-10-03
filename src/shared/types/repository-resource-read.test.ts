import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/repository-resource-read.json';
import {
  RepositoryResourceCaptureSchema,
  RepositoryResourceResultSchema,
  RepositoryResourceTargetSchema,
  isRepositoryResourceResultFor,
} from './repository-resource-read';
describe('explicit resource wire decoding', () => {
  it.each(['mergeRequest', 'issue'] as const)(
    'correlates the actual %s projection without losing unknown values',
    (key) => {
      const capture = RepositoryResourceCaptureSchema.parse(fixture.capture);
      const result = RepositoryResourceResultSchema.parse(fixture[key]);
      expect(isRepositoryResourceResultFor(result, capture, result.target)).toBe(true);
      expect(result.quota.remaining).toBeNull();
      expect(result.scope.authorityGeneration).toBe('9007199254740995');
      if (result.outcome.kind === 'merge-request') {
        expect(result.outcome.snapshot.details.mergeable).toBeNull();
        expect(result.outcome.snapshot).not.toHaveProperty('checks');
      }
    },
  );
  it.each([0, '01', '18446744073709551616', '-1'])(
    'rejects invalid or lossy counters %j',
    (authorityGeneration) => {
      expect(
        RepositoryResourceCaptureSchema.safeParse({
          ...fixture.capture,
          scope: { ...fixture.capture.scope, authorityGeneration },
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    { number: 0 },
    { number: 9007199254740992 },
    { kind: 'pull-request' },
    { extra: true },
    { repository: { ...fixture.issue.target.repository, projectPath: 'a/../b' } },
    {
      repository: {
        ...fixture.issue.target.repository,
        instanceBaseUrl: 'https://user@gitlab.example.test',
      },
    },
  ])('rejects malformed target %j', (change) => {
    expect(
      RepositoryResourceTargetSchema.safeParse({ ...fixture.issue.target, ...change }).success,
    ).toBe(false);
  });
  it.each(['readLifetimeId', 'target', 'revision', 'scope'] as const)(
    'refuses a foreign %s',
    (field) => {
      const capture = RepositoryResourceCaptureSchema.parse(fixture.capture);
      const result = RepositoryResourceResultSchema.parse(fixture.issue);
      if (field === 'readLifetimeId') result.readLifetimeId = 'other';
      if (field === 'target') result.target.kind = 'merge-request';
      if (field === 'revision') result.revision.sequence = '9007199254740997';
      if (field === 'scope') result.scope.daemonId = 'other';
      expect(
        isRepositoryResourceResultFor(
          result,
          capture,
          RepositoryResourceTargetSchema.parse(fixture.issue.target),
        ),
      ).toBe(false);
    },
  );
  it('refuses a same-number response from another project', () => {
    const result = RepositoryResourceResultSchema.parse(fixture.issue);
    if (result.outcome.kind === 'issue')
      result.outcome.issue.url = 'https://gitlab.example.test:8443/forge/other/project/-/issues/42';
    expect(
      isRepositoryResourceResultFor(
        result,
        RepositoryResourceCaptureSchema.parse(fixture.capture),
        result.target,
      ),
    ).toBe(false);
  });
});
