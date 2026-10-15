import { describe, it, expect } from 'vitest';
import { parseGitDiffOrigin, matchingGitDiffOrigin } from './workspace-diff-target';
const origin = { workspaceId: 'owned-workspace', path: 'src/example.ts', staged: true, y: 344 };
describe('Git review return context', () => {
  it('preserves the exact staged row and viewport through the URL codec', () => {
    const search = new URLSearchParams({ diffOrigin: JSON.stringify(origin) });
    expect(
      matchingGitDiffOrigin(search.get('diffOrigin'), origin.workspaceId, origin.path, true),
    ).toEqual(origin);
  });
  it.each([
    undefined,
    'null',
    '{}',
    'broken',
    'x'.repeat(8193),
    JSON.stringify({ ...origin, path: '../elsewhere' }),
    JSON.stringify({ ...origin, staged: 'true' }),
    JSON.stringify({ ...origin, y: Infinity }),
    JSON.stringify({ ...origin, y: 100001 }),
  ])('rejects malformed context %j', (raw) => expect(parseGitDiffOrigin(raw)).toBeUndefined());
  it('does not match another workspace, path or stage', () => {
    const raw = JSON.stringify(origin);
    expect(matchingGitDiffOrigin(raw, 'other', origin.path, true)).toBeUndefined();
    expect(matchingGitDiffOrigin(raw, origin.workspaceId, 'other.ts', true)).toBeUndefined();
    expect(matchingGitDiffOrigin(raw, origin.workspaceId, origin.path, false)).toBeUndefined();
  });
});
