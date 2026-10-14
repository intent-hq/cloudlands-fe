import { describe, expect, it } from 'vitest';
import { extractFilePathTarget, resolveFilePathTarget } from '../file-link-target';

const origin = 'http://localhost:5412';
const root = '/repo/worktree';
function resolve(href: string, workspaceRoot = root) {
  const target = extractFilePathTarget(`${origin}/resolved`, href, origin);
  return target ? resolveFilePathTarget(target, workspaceRoot) : null;
}

describe('shared file-link path policy', () => {
  it('uses raw hrefs and parses locations before decoding literal filename punctuation', () => {
    expect(resolve('/repo/worktree/docs/a%23b%3Ac.md:12:3')).toEqual({
      kind: 'workspace',
      path: 'docs/a#b:c.md',
      line: 12,
      column: 3,
    });
    expect(resolve('./docs/a%2523b.md#L4')).toEqual({
      kind: 'workspace',
      path: 'docs/a%23b.md',
      line: 4,
      column: undefined,
    });
  });

  it.each([
    '../secret',
    '%2e%2e/secret',
    'docs/%2e%2e/secret',
    'docs\\..\\secret',
    'a%00b',
    'a%ZZ',
    '.',
  ])('rejects invalid or traversal paths: %s', (href) => {
    expect(resolve(href)).toBeNull();
  });

  it.each(['/repo/worktree-other/secret', '/outside/file:2:4', 'C:/outside/file'])(
    'keeps outside-root targets distinct from admitted workspace paths: %s',
    (href) => {
      expect(resolve(href)?.kind).toBe('external');
    },
  );

  it('normalizes Windows roots without treating URL schemes as drives', () => {
    expect(resolve('C:\\repo\\worktree\\docs\\a.md:7', 'C:\\repo\\worktree\\')).toMatchObject({
      kind: 'workspace',
      path: 'docs/a.md',
      line: 7,
    });
    expect(extractFilePathTarget('x://host/file')).toBeNull();
  });

  it.each([
    '//other/secret',
    '#section',
    'https://other/file',
    'intent://local/file/docs/a.md',
    'file:///outside/secret',
  ])('does not classify non-path hrefs as raw file paths: %s', (href) => {
    expect(extractFilePathTarget(href, href, origin)).toBeNull();
  });

  it('permits only explicitly matching app-origin resolved pathnames', () => {
    const target = extractFilePathTarget(`${origin}/docs/a.md#L9`, undefined, origin);
    expect(target).toEqual({ path: '/docs/a.md#L9', fromResolvedUrl: true });
    expect(resolveFilePathTarget(target!, root)).toMatchObject({
      kind: 'workspace',
      path: 'docs/a.md',
      line: 9,
    });
    expect(extractFilePathTarget(`${origin}/docs/a.md`)).toBeNull();
    expect(extractFilePathTarget('https://other/docs/a.md', undefined, origin)).toBeNull();
  });
});
