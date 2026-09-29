import {
  installMockElectronBridge,
  type MockBackendMethodHandler,
} from '../../test/ct-mock-electron-bridge';
import type { store } from '$store/renderer/store';
import { homeIntegrationsSaga } from './home-integrations-saga';

interface HomeIntegrationWireCall {
  method: string;
  params: Record<string, unknown>;
}
interface HomeIntegrationBrowserControl {
  calls: HomeIntegrationWireCall[];
  releaseSearch: () => void;
}
declare global {
  interface Window {
    __homeIntegrationBrowser?: HomeIntegrationBrowserControl;
  }
}

/** Browser-only protocol fixtures. Runs the production saga against the Electron wire seam. */
export function setupHomeIntegrationsFixtures(appStore: Pick<typeof store, 'runSaga'>) {
  const previous = window.electronAPI;
  const calls: HomeIntegrationWireCall[] = [];
  let releaseSearch = () => {};
  let pageFailed = false;
  window.__homeIntegrationBrowser = { calls, releaseSearch: () => releaseSearch() };
  const pull = {
    number: 142,
    title: 'Keep workspace previews in sync',
    body: '## Reconnect recovery\n\nPreserve **selection** and refresh status.',
    state: 'open',
    htmlUrl: 'https://github.com/acme/studio/pull/142',
    createdAt: '2026-09-28T20:00:00Z',
    updatedAt: '2026-09-28T22:10:00Z',
    user: { login: 'avery', avatarUrl: '', htmlUrl: 'https://github.com/avery' },
    headRef: 'fix/reconnect',
    baseRef: 'main',
    headSha: 'abc123',
    baseSha: 'def456',
    merged: false,
    draft: false,
    labels: ['frontend'],
    comments: 0,
    reviewComments: 1,
    commits: 2,
    additions: 128,
    deletions: 34,
    changedFiles: 5,
  };
  const issue = {
    id: 'linear-318',
    identifier: 'DES-318',
    title: 'Make attention states easier to scan',
    description: '## Acceptance criteria\n\nSupport **keyboard navigation**.',
    url: 'https://linear.app/acme/issue/DES-318',
    teamName: 'Design Engineering',
    teamKey: 'DES',
    state: 'In progress',
    priority: 2,
    assignee: 'Jordan Lee',
    creator: 'Avery Morgan',
    labels: ['UX'],
    project: 'Workspace clarity',
    createdAt: '2026-09-28T20:00:00Z',
    updatedAt: '2026-09-28T22:00:00Z',
  };
  const handlers: Record<string, MockBackendMethodHandler> = {
    'github.authStatus': () => ({
      isConfigured: true,
      oauthUrl: '',
      configuredButNeedsUpdate: false,
      updatedScopes: '',
      deviceFlow: null,
    }),
    'github.pulls.search': async (raw) => {
      const params = raw as Record<string, unknown>;
      if (params.query === 'stale') {
        await new Promise<void>((resolve) => {
          releaseSearch = resolve;
        });
        return {
          pulls: [
            { ...pull, owner: params.owner, repo: params.repo, title: 'Stale search response' },
          ],
          nextToken: null,
        };
      }
      if (params.nextToken && !pageFailed) {
        pageFailed = true;
        throw new Error('Fixture page unavailable');
      }
      const number = params.nextToken ? 143 : 142;
      return {
        pulls: [
          {
            ...pull,
            number,
            htmlUrl: `https://github.com/${params.owner}/${params.repo}/pull/${number}`,
            owner: params.owner,
            repo: params.repo,
            title: params.query
              ? 'Latest query result'
              : params.nextToken
                ? 'Second page pull request'
                : pull.title,
          },
        ],
        nextToken: params.nextToken || params.query ? null : 'page-two',
      };
    },
    'github.pulls.get': (raw) => {
      const params = raw as { owner: string; repo: string; number: number };
      return {
        pull: {
          ...pull,
          number: params.number,
          htmlUrl: `https://github.com/${params.owner}/${params.repo}/pull/${params.number}`,
        },
      };
    },
    'github.listReviewComments': () => ({
      comments: [
        {
          id: 1,
          body: 'Please preserve **focus** after refresh.',
          path: 'src/Home.svelte',
          line: 42,
          user: { login: 'jordan' },
          createdAt: pull.createdAt,
          updatedAt: pull.updatedAt,
          htmlUrl: `${pull.htmlUrl}#discussion_r1`,
        },
      ],
      nextToken: null,
    }),
    'linear.authStatus': () => ({ authenticated: true, login: 'Jordan Lee', scopes: [] }),
    'linear.listIssues': () => ({ issues: [issue], nextToken: null }),
    'linear.searchIssues': () => ({ issues: [issue], nextToken: null }),
    'linear.getIssue': () => issue,
  };
  installMockElectronBridge(
    Object.fromEntries(
      Object.entries(handlers).map(([method, handler]) => [
        method,
        (params: unknown) => {
          calls.push({ method, params: JSON.parse(JSON.stringify(params ?? {})) });
          return handler(params);
        },
      ]),
    ),
  );
  const stop = appStore.runSaga(homeIntegrationsSaga);
  return () => {
    stop();
    releaseSearch();
    window.electronAPI = previous;
    delete window.__homeIntegrationBrowser;
  };
}
