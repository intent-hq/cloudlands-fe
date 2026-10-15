import { describe, it, expect } from 'vitest';
import { isCommitHash, parseHistoryOrigin } from './workspace-history-target';
const hash = 'a'.repeat(40);
describe('commit history navigation context', () => {
  it('keeps exact hash, path and bounded viewport anchor without URL authority', () => {
    expect(
      parseHistoryOrigin(
        JSON.stringify({
          workspaceId: 'owned',
          hash,
          path: 'deleted/file.txt',
          y: -250,
          redirect: 'https://outside.invalid',
        }),
      ),
    ).toEqual({ workspaceId: 'owned', hash, path: 'deleted/file.txt', y: -250 });
  });
  it.each(['HEAD', 'a'.repeat(39), 'a'.repeat(41), '../main', 'https://outside.invalid'])(
    'rejects noncanonical commit target %s',
    (value) => expect(isCommitHash(value)).toBe(false),
  );
  it.each(['../outside', '/etc/passwd', 'file://outside', 'bad\u0000name'])(
    'rejects unconfined file path %s',
    (path) =>
      expect(
        parseHistoryOrigin(JSON.stringify({ workspaceId: 'owned', hash, path, y: 0 })),
      ).toBeUndefined(),
  );
  it.each([
    null,
    '{}',
    '[1,2]',
    JSON.stringify({ workspaceId: 'owned', hash, path: 'a', y: 100001 }),
    'x'.repeat(8193),
  ])('rejects malformed return context', (value) =>
    expect(parseHistoryOrigin(value)).toBeUndefined(),
  );
});
