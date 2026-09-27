import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '$shared/types/__fixtures__/repository-context.json';
import type { RepositoryContextRequest } from '$shared/types/repository-context';
import { backendRequest } from './backend-transport';
import { createRepositoryContextTransport } from './repository-context-transport';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));
const request = vi.mocked(backendRequest);
const capture: RepositoryContextRequest = {
  requestId: 'read-1',
  binding: 'upstream-context-1',
  workspaceId: 'workspace-1',
};

describe('inactive repository-context transport boundary', () => {
  beforeEach(() => {
    request.mockReset();
  });

  it('does not make a call at construction and uses the connected-daemon path on an explicit read', async () => {
    const transport = createRepositoryContextTransport();
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue(fixture);
    expect(await transport.read(capture)).toEqual({ request: capture, context: fixture });
    expect(request).toHaveBeenCalledExactlyOnceWith('workspace.repositoryContext', {
      workspaceId: 'workspace-1',
    });
  });

  it('preserves the captured workspace/root even when the caller changes its selection during the await', async () => {
    let resolve!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const mutable = { ...capture, gitRootId: 'root-original' };
    const pending = createRepositoryContextTransport().read(mutable);
    mutable.workspaceId = 'workspace-other';
    mutable.gitRootId = 'root-other';
    mutable.binding = 'other-account';
    const wire = {
      ...fixture,
      roots: [
        {
          ...fixture.roots[0],
          root: { workspaceId: 'workspace-1', kind: 'registered', gitRootId: 'root-original' },
        },
      ],
    };
    resolve(wire);

    expect(await pending).toEqual({
      request: { ...capture, gitRootId: 'root-original' },
      context: wire,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('workspace.repositoryContext', {
      workspaceId: 'workspace-1',
      gitRootId: 'root-original',
    });
  });

  it.each(['wrong-workspace', 'wrong-root', 'duplicate-root', 'missing-root'])(
    'rejects a %s response instead of applying it to the current target',
    async (kind) => {
      const root = {
        ...fixture.roots[0],
        root: { workspaceId: 'workspace-1', kind: 'registered', gitRootId: 'root-original' },
      };
      if (kind === 'wrong-workspace') root.root.workspaceId = 'workspace-other';
      if (kind === 'wrong-root') root.root.gitRootId = 'root-other';
      request.mockResolvedValue({
        ...fixture,
        roots: kind === 'missing-root' ? [] : kind === 'duplicate-root' ? [root, root] : [root],
      });
      await expect(
        createRepositoryContextTransport().read({ ...capture, gitRootId: 'root-original' }),
      ).rejects.toThrow('does not match');
    },
  );

  it('does not turn malformed or missing data into a passing empty context', async () => {
    request.mockResolvedValue({ roots: [] });
    await expect(createRepositoryContextTransport().read(capture)).rejects.toThrow();
  });

  it.each([
    'selection-required',
    'repository-unavailable',
    'context-changed',
    'source-control-unauthorized',
    'forbidden',
  ])('preserves the %s daemon refusal without retry or fallback', async (code) => {
    const error = Object.assign(new Error('Request unavailable'), {
      code,
      rpcCode: -32003,
      data: { code },
    });
    request.mockRejectedValue(error);
    await expect(createRepositoryContextTransport().read(capture)).rejects.toBe(error);
    expect(request).toHaveBeenCalledOnce();
  });
});
