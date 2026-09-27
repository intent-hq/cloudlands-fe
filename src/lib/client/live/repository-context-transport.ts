import {
  RepositoryContextSchema,
  isRepositoryContextForRequest,
  type RepositoryContextRequest,
  type RepositoryContextResponse,
} from '$shared/types/repository-context';
import { backendRequest } from './backend-transport';

/**
 * Inactive contract boundary for the forthcoming context read. No startup
 * caller, singleton, capability flag, retry or local-machine routing override.
 * The final registered service/capability integration must precede UI use.
 */
export function createRepositoryContextTransport(request = backendRequest) {
  return {
    async read(capture: RepositoryContextRequest): Promise<RepositoryContextResponse> {
      const captured = { ...capture };
      const context = RepositoryContextSchema.parse(
        await request<unknown>('workspace.repositoryContext', {
          workspaceId: captured.workspaceId,
          ...(captured.gitRootId === undefined ? {} : { gitRootId: captured.gitRootId }),
        }),
      );
      if (!isRepositoryContextForRequest(context, captured)) {
        throw new Error('Repository context does not match the requested workspace/root');
      }
      return { request: captured, context };
    },
  };
}
