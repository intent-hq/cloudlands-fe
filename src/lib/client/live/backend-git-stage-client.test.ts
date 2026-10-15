import { describe, expect, it, vi } from 'vitest';
import { BackendError, type BackendTransport } from './backend-transport-types';
import { createBackendGitStageClient } from './backend-git-stage-client';

describe('injected explicit-path Git staging client', () => {
  it.each(['stage', 'unstage'] as const)(
    'sends the exact %s request and settles the daemon response',
    async (kind) => {
      const request = vi.fn<BackendTransport['request']>().mockResolvedValue({ ok: true });
      const client = createBackendGitStageClient(request);
      await expect(client[kind]('workspace', [' src/a.ts ', '', 'dir/ü file.ts'])).resolves.toEqual(
        { success: true },
      );
      expect(request).toHaveBeenCalledExactlyOnceWith(`git.${kind}`, {
        workspaceId: 'workspace',
        paths: ['src/a.ts', 'dir/ü file.ts'],
      });
    },
  );

  it.each(['stage', 'unstage'] as const)(
    'rejects empty and all-files %s requests before transport',
    async (kind) => {
      const request = vi.fn<BackendTransport['request']>();
      const client = createBackendGitStageClient(request);
      for (const paths of [[], ['  '], ['.'], ['*'], ['--all'], ['a.ts', 'x--all']]) {
        await expect(client[kind]('workspace', paths)).resolves.toMatchObject({ success: false });
      }
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(['stage', 'unstage'] as const)(
    'preserves structured daemon %s failures',
    async (kind) => {
      const request = vi.fn<BackendTransport['request']>().mockRejectedValue(
        new BackendError({
          code: 'internal',
          rpcCode: -32603,
          message: 'Internal error',
          data: { detail: 'index is locked' },
        }),
      );
      await expect(
        createBackendGitStageClient(request)[kind]('workspace', ['a.ts']),
      ).resolves.toEqual({
        success: false,
        error: 'Internal error: index is locked',
      });
      expect(request).toHaveBeenCalledExactlyOnceWith(`git.${kind}`, {
        workspaceId: 'workspace',
        paths: ['a.ts'],
      });
    },
  );
});
