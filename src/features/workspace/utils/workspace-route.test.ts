import { describe, expect, it } from 'vitest';
import { isWorkspaceRoutePath } from './workspace-route';

describe('isWorkspaceRoutePath', () => {
  it.each([
    ['/workspace/ws-1', true],
    ['/workspace/ws-1/', true],
    ['/workspace/ws-1/settings', true],
    ['/workspace/ws-10', false],
    ['/workspace/ws', false],
    ['/', false],
    ['/settings', false],
  ])('%s → %s for ws-1', (path, expected) => {
    expect(isWorkspaceRoutePath(path, 'ws-1')).toBe(expected);
  });
});
