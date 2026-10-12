import type { BackendRuntime } from '../../../lib/client/live/backend-transport-runtime';
import { GITHUB_AUTH_CHANNELS } from '../constants';
import type { GithubRepo } from '../types';
import {
  errorMessage,
  toLegacyRepo,
  workspaceParams,
  type GithubRepoWire,
} from './integration-read-utils';

type GithubRepositoryInvoke = (
  channel: typeof GITHUB_AUTH_CHANNELS.LIST_REPOS,
  params: { page: number | undefined; workspaceId?: string },
) => Promise<{ success: boolean; data?: GithubRepo[]; error?: string }>;

/** The active source route, including its original workspace getter order. */
export function createGithubRepositoryReadHandler({
  backendRequest,
}: Pick<BackendRuntime, 'backendRequest'>) {
  return async (arg: unknown) => {
    try {
      const result = await backendRequest<{ repos?: GithubRepoWire[] }>(
        'github.repos.list',
        ...(workspaceParams(arg).workspaceId === undefined ? [] : [workspaceParams(arg)]),
      );
      return { success: true, data: (result?.repos ?? []).map(toLegacyRepo) };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  };
}

/** The original public async layer; the invoke port is specific to this route. */
export function createGithubRepositoryClient({ invoke }: { invoke: GithubRepositoryInvoke }) {
  return {
    async listRepos(page?: number, workspaceId?: string): Promise<GithubRepo[]> {
      const result = await invoke(GITHUB_AUTH_CHANNELS.LIST_REPOS, {
        page,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      });
      if (!result.success) throw new Error(result.error || 'Repository discovery failed'); // i18n-ignore (wire-error fallback)
      return result.data ?? [];
    },
  };
}
