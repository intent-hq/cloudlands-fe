import { describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend-transport-types';
import { createBackendGitCommitClient } from './backend-git-commit-client';

type Request = Parameters<typeof createBackendGitCommitClient>[0];
const params = {
  message: 'Checkpoint staged changes',
  userRequested: true,
  currentIndex: true,
} as const;
const receipt = {
  ok: true,
  hash: '0123456789abcdef0123456789abcdef01234567',
  files: ['a.ts'],
  fileCount: 1,
};

describe('canonical current-index commit client', () => {
  it('preserves a confirmed SHA-256 receipt and an empty merge delta', async () => {
    const hash = '0123456789abcdef'.repeat(4);
    const request = vi.fn<Request>().mockResolvedValue({ ok: true, hash, files: [], fileCount: 0 });
    await expect(
      createBackendGitCommitClient(request).commit('workspace', params),
    ).resolves.toEqual({ success: true, commitOutcome: { state: 'confirmed', hash, files: [] } });
  });
  it('omits files and local policy from the wire, and retains the authoritative receipt', async () => {
    const request = vi.fn<Request>().mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      return receipt as never;
    });
    await expect(
      createBackendGitCommitClient(request).commit('workspace', params),
    ).resolves.toEqual({
      success: true,
      commitOutcome: { state: 'confirmed', hash: receipt.hash, files: ['a.ts'] },
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      'git.agentCommit',
      {
        workspaceId: 'workspace',
        message: params.message,
        userRequested: true,
      },
      { onDispatch: expect.any(Function) },
    );
  });

  it.each([
    { ...params, userRequested: false },
    { ...params, files: [] },
    { ...params, files: ['a.ts'] },
    { ...params, amend: true },
  ])('refuses invalid current-index intent before any request: %j', async (input) => {
    const request = vi.fn<Request>();
    const result = await createBackendGitCommitClient(request).commit('workspace', input);
    expect(result.success).toBe(false);
    expect(result.commitOutcome).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps a known local predispatch rejection retryable', async () => {
    const request = vi
      .fn<Request>()
      .mockRejectedValue(new Error('Connection changed before dispatch'));
    await expect(
      createBackendGitCommitClient(request).commit('workspace', params),
    ).resolves.toEqual({
      success: false,
      error: 'Connection changed before dispatch',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Error('Connection lost'),
    new Error('Request timeout'),
    new BackendError({
      code: 'internal',
      rpcCode: -32603,
      message: 'Internal error',
      data: { detail: 'post-write bookkeeping failed' },
    }),
  ])('retains uncertainty after dispatch without retry: %s', async (error) => {
    const request = vi.fn<Request>().mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      throw error;
    });
    await expect(
      createBackendGitCommitClient(request).commit('workspace', params),
    ).resolves.toMatchObject({
      success: false,
      commitOutcome: { state: 'unknown' },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { ok: true },
    { ...receipt, ok: false },
    { ...receipt, hash: '' },
    { ...receipt, hash: 'abc123' },
    { ...receipt, hash: 'g'.repeat(40) },
    { ...receipt, hash: 'a'.repeat(41) },
    { ...receipt, files: [''] },
    { ...receipt, files: [null] },
  ])('does not claim confirmation from a malformed receipt: %j', async (response) => {
    const request = vi.fn<Request>().mockResolvedValue(response);
    await expect(
      createBackendGitCommitClient(request).commit('workspace', params),
    ).resolves.toEqual({
      success: false,
      commitOutcome: { state: 'unknown' },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, [], [' a.ts ', 'b.ts']])(
    'preserves legacy explicit-files semantics: %j',
    async (files) => {
      const request = vi.fn<Request>().mockResolvedValue(receipt);
      await expect(
        createBackendGitCommitClient(request).commit('workspace', {
          message: 'Legacy',
          files,
          amend: true,
          userRequested: true,
        }),
      ).resolves.toEqual({ success: true });
      expect(request).toHaveBeenCalledExactlyOnceWith('git.agentCommit', {
        workspaceId: 'workspace',
        message: 'Legacy',
        ...(files !== undefined ? { files } : {}),
        userRequested: true,
      });
    },
  );
});
