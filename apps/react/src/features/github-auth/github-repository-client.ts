import { GITHUB_AUTH_CHANNELS } from '../../../../../src/features/github-auth/constants';
import {
  createGithubRepositoryClient,
  createGithubRepositoryReadHandler,
} from '../../../../../src/features/github-auth/renderer/github-repository-read-factory';
import { backend } from '../backend/backend-transport';

const listRepositories = createGithubRepositoryReadHandler({
  backendRequest: <T>(...args: Parameters<typeof backend.backendRequest>) =>
    backend.backendRequest<T>(...args),
});
const routes = { [GITHUB_AUTH_CHANNELS.LIST_REPOS]: listRepositories };

/** Read-only source-route composition; no global handler or root registration. */
export const githubRepositoryClient = createGithubRepositoryClient({
  invoke: (channel, params) => routes[channel](params),
});
