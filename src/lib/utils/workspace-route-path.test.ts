import { describe, expect, it } from 'vitest';
import {
  isWorkspaceRoutePath,
  parseWorkspaceRoute,
  workspaceIdOwningPath,
} from './workspace-route-path';

describe('parseWorkspaceRoute', () => {
  it.each([
    ['/workspace/ws-1', 'ws-1'],
    ['/workspace/ws-1/', 'ws-1'],
    ['/workspace/ws-1?note=n1#top', 'ws-1'],
    ['/workspace/a%2Fb', 'a/b'],
  ])('reads the workspace id from %s', (route, workspaceId) => {
    expect(parseWorkspaceRoute(route)).toBe(workspaceId);
  });

  it.each([
    '/',
    '/settings',
    '/workspace/new',
    '/workspace/creating',
    '/workspace/',
    '/workspace/ws-1/files',
    '/workspace/%E0',
  ])('is null for %s', (route) => {
    expect(parseWorkspaceRoute(route)).toBeNull();
  });
});

describe('workspaceIdOwningPath', () => {
  it.each([
    ['/workspace/ws-1', 'ws-1'],
    ['/workspace/ws-1/', 'ws-1'],
    ['/workspace/ws-1/files', 'ws-1'],
    ['/workspace/ws-1/terminal-test?x=1', 'ws-1'],
    ['/workspace/ws-1#top', 'ws-1'],
    ['/workspace/a%2Fb/files', 'a/b'],
  ])('reads the owning workspace of %s', (path, workspaceId) => {
    expect(workspaceIdOwningPath(path)).toBe(workspaceId);
  });

  it.each([
    '/',
    '/settings',
    '/workspace',
    '/workspace/',
    '/workspace/new',
    '/workspace/creating',
    '/workspace/%E0/files',
    '/workspaces/ws-1',
  ])('is null for %s', (path) => {
    expect(workspaceIdOwningPath(path)).toBeNull();
  });
});

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

  it('matches an encoded id against its decoded form', () => {
    expect(isWorkspaceRoutePath('/workspace/a%2Fb', 'a/b')).toBe(true);
  });

  it('never matches an empty id', () => {
    expect(isWorkspaceRoutePath('/workspace/', '')).toBe(false);
  });
});
