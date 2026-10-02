import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./backend-transport-factory', () => ({
  resolveBackendTransport: () => ({ request: mocks.request }),
}));
import { backendRequest } from './backend-transport';
import { BackendError } from './backend-transport-types';

describe('member execution authorization errors', () => {
  it.each(['missing', 'rejected', 'insufficient-scope'])(
    'renders %s as host-owner recovery without provider response text',
    async (reason) => {
      mocks.request.mockRejectedValue(
        new BackendError({
          code: 'host-execution-authorization',
          rpcCode: -32603,
          message: 'raw provider body secret=do-not-render',
          data: {
            executionAuthorization: {
              resource: 'git',
              reason,
              providerId: 'github',
              host: 'github.com',
              recovery: {
                actor: 'host-owner',
                action: 'check-git-authorization',
                setting: 'sourceControl.github.exposeGitCredentialToChildren',
              },
            },
          },
        }),
      );
      const error = await backendRequest('git.push', { workspaceId: 'member-workspace' }).catch(
        (e) => e,
      );
      expect(error.message).not.toContain('do-not-render');
      expect(error.message).toMatch(/owner/i);
      expect(error.message).toContain('sourceControl.github.exposeGitCredentialToChildren');
      expect(error.rpcCode).toBe(-32603);
      expect(error.data.executionAuthorization.reason).toBe(reason);
    },
  );

  it.each(['network failure', 'cancelled', 'repository missing', 'rate limited'])(
    'preserves an unclassified %s',
    async (message) => {
      const original = new BackendError({ code: 'ERROR', message });
      mocks.request.mockRejectedValue(original);
      await expect(backendRequest('git.push', {})).rejects.toBe(original);
    },
  );
});
