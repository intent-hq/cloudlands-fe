import { describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend-transport-types';
import { createBackendGitCommitReader } from './backend-git-commit-reader';

type Request = Parameters<typeof createBackendGitCommitReader>[0];
const details = {
  commitHash: '0123456789abcdef0123456789abcdef01234567',
  author: 'Ada',
  authorEmail: 'ada@example.test',
  date: '2026-10-15T05:00:00Z',
  message: 'Commit inspection',
  files: ['src/a.ts'],
  fileDetails: [{ path: 'src/a.ts', additions: 2, deletions: 1 }],
};

describe('strict canonical Git commit inspection', () => {
  it('rejects a different commit when the requested revision is a full object id', async () => {
    const request = vi.fn<Request>().mockResolvedValue({ ...details, commitHash: 'a'.repeat(40) });
    await expect(
      createBackendGitCommitReader(request)('workspace', details.commitHash),
    ).rejects.toThrow(TypeError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('compares explicit SHA spelling without changing returned wire metadata', async () => {
    const request = vi.fn<Request>().mockResolvedValue(details);
    await expect(
      createBackendGitCommitReader(request)('workspace', details.commitHash.toUpperCase()),
    ).resolves.toEqual(details);
  });

  it('accepts full SHA-256 object ids', async () => {
    const response = { ...details, commitHash: '0123456789abcdef'.repeat(4) };
    const request = vi.fn<Request>().mockResolvedValue(response);
    await expect(
      createBackendGitCommitReader(request)('workspace', response.commitHash),
    ).resolves.toEqual(response);
  });

  it('rejects an unavailable envelope echoing a different requested reference', async () => {
    const request = vi.fn<Request>().mockResolvedValue({
      commitHash: 'other',
      author: '',
      authorEmail: '',
      date: '',
      message: '',
      files: [],
      fileDetails: [],
    });
    await expect(createBackendGitCommitReader(request)('workspace', 'HEAD')).rejects.toThrow(
      TypeError,
    );
  });
  it('sends exactly the primary-root request and preserves the daemon details', async () => {
    const request = vi.fn<Request>().mockResolvedValue(details);
    await expect(createBackendGitCommitReader(request)('workspace', 'HEAD')).resolves.toEqual(
      details,
    );
    expect(request).toHaveBeenCalledExactlyOnceWith('git.commitDetails', {
      workspaceId: 'workspace',
      commitHash: 'HEAD',
    });
  });

  it('forwards the explicit secondary root without inventing other request fields', async () => {
    const request = vi.fn<Request>().mockResolvedValue(details);
    await createBackendGitCommitReader(request)('workspace', details.commitHash, {
      gitRootId: 'other-root',
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('git.commitDetails', {
      workspaceId: 'workspace',
      commitHash: details.commitHash,
      gitRootId: 'other-root',
    });
  });

  it('preserves the documented daemon empty envelope without synthesizing metadata', async () => {
    const empty = {
      commitHash: 'missing',
      author: '',
      authorEmail: '',
      date: '',
      message: '',
      files: [],
      fileDetails: [],
    };
    const request = vi.fn<Request>().mockResolvedValue(empty);
    await expect(createBackendGitCommitReader(request)('workspace', 'missing')).resolves.toEqual(
      empty,
    );
  });

  it.each([
    new Error('Connection lost'),
    new BackendError({ code: 'forbidden', rpcCode: -32003, message: 'Access denied' }),
  ])(
    'preserves the actual read failure instead of returning an empty result: %s',
    async (error) => {
      const request = vi.fn<Request>().mockRejectedValue(error);
      await expect(createBackendGitCommitReader(request)('workspace', 'HEAD')).rejects.toBe(error);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    {},
    { ...details, commitHash: undefined },
    { ...details, commitHash: 'abc123' },
    { ...details, commitHash: 'HEAD' },
    { ...details, commitHash: 'g'.repeat(40) },
    { ...details, author: null },
    { ...details, files: undefined },
    { ...details, files: [null] },
    { ...details, fileDetails: undefined },
    { ...details, fileDetails: [{ path: 'a.ts', additions: 2 }] },
    { ...details, fileDetails: [{ path: 'a.ts', additions: -1, deletions: 0 }] },
    { ...details, fileDetails: [{ path: 'a.ts', additions: NaN, deletions: 0 }] },
  ])('rejects malformed details rather than healing them: %j', async (response) => {
    const request = vi.fn<Request>().mockResolvedValue(response);
    await expect(createBackendGitCommitReader(request)('workspace', 'HEAD')).rejects.toThrow(
      TypeError,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
