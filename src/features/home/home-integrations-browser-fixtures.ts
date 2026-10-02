import { selectWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import { resolveGitHubPrefillSelection } from '$lib/components/workspace/initializer/github-prefill';
import type { WorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
import { store as rendererStore } from '$store/renderer/store';
import {
  installMockElectronBridge,
  type MockBackendMethodHandler,
} from '../../test/ct-mock-electron-bridge';
import { homeIntegrationsSaga } from './home-integrations-saga';

interface HomeIntegrationWireCall {
  method: string;
  params: Record<string, unknown>;
}
interface HomeIntegrationBrowserControl {
  calls: HomeIntegrationWireCall[];
  releaseSearch: () => void;
  readPrefill: () => WorkspaceInitializerPendingGitHubPrefill | null;
  resolvePrefill: () => ReturnType<typeof resolveGitHubPrefillSelection>;
}
declare global {
  interface Window {
    __homeIntegrationBrowser?: HomeIntegrationBrowserControl;
  }
}

/** Browser-only protocol fixtures. Runs the production saga against the Electron wire seam. */
export function setupHomeIntegrationsFixtures(appStore: Pick<typeof rendererStore, 'runSaga'>) {
  const previous = window.electronAPI;
  const calls: HomeIntegrationWireCall[] = [];
  let releaseSearch = () => {};
  let pageFailed = false;
  let filePageFailed = false;
  window.__homeIntegrationBrowser = {
    calls,
    releaseSearch: () => releaseSearch(),
    readPrefill: () => selectWorkspaceInitializerPendingGitHubPrefill.select(rendererStore.state),
    resolvePrefill: () =>
      resolveGitHubPrefillSelection(
        selectWorkspaceInitializerPendingGitHubPrefill.select(rendererStore.state)!,
      ),
  };
  const pull = {
    number: 142,
    title: 'Keep workspace previews in sync',
    body: '## Reconnect recovery\n\nPreserve **selection** and refresh status.',
    state: 'open',
    htmlUrl: 'https://github.com/acme/studio/pull/142',
    createdAt: '2026-09-28T20:00:00Z',
    updatedAt: '2026-09-28T22:10:00Z',
    user: {
      login: 'avery',
      avatarUrl: 'https://avatars.githubusercontent.com/u/12345?v=4',
      htmlUrl: 'https://github.com/avery',
    },
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
      // Organization hits deliberately include a repo absent from Home's sidebar.
      if (typeof params.org === 'string' && params.org.startsWith('legacy-'))
        throw new Error('invalid params: Missing required parameter: owner');
      if (params.org) {
        // Hold only the original scope so switching owners cannot replace its release handle.
        if (params.org === 'acme' && params.query === 'stale') {
          await new Promise<void>((resolve) => {
            releaseSearch = resolve;
          });
        }
        return {
          pulls: [
            {
              ...pull,
              number: params.nextToken ? 143 : pull.number,
              owner: params.org,
              repo: 'outside-sidebar',
              htmlUrl: `https://github.com/${params.org}/outside-sidebar/pull/${params.nextToken ? 143 : pull.number}`,
              title: params.query === 'stale' ? 'Stale search response' : pull.title,
            },
          ],
          nextToken: params.nextToken || params.query ? null : 'org-page-two',
        };
      }
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
    'github.repos.search': (raw) => {
      const params = raw as Record<string, unknown>;
      if (params.query === 'user:legacy-loop fork:true')
        return { repos: [{ owner: 'legacy-loop', name: 'outside-sidebar' }], nextToken: 'repeat' };
      const names = params.nextToken
        ? ['repo7']
        : ['outside-sidebar', 'repo2', 'repo3', 'repo4', 'repo5', 'repo6'];
      return {
        repos: names.map((name) => ({ owner: 'legacy-acme', name })),
        nextToken: params.nextToken ? null : 'repos-two',
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
    'github.pulls.checks': () => ({
      headSha: 'abc123',
      checks: [
        {
          name: 'Typecheck',
          state: 'success',
          url: 'https://github.com/acme/studio/actions/runs/1',
        },
        { name: 'Browser tests', state: 'pending', url: null },
        { name: 'Lint', state: 'failure', url: 'https://github.com/acme/studio/actions/runs/2' },
      ],
    }),
    'github.pulls.reviews': () => ({
      reviews: [
        {
          id: 1,
          author: 'jordan',
          state: 'APPROVED',
          body: 'Looks good after the **reconnect** fix.',
          submittedAt: pull.updatedAt,
          url: pull.htmlUrl + '#pullrequestreview-1',
        },
      ],
      nextToken: null,
    }),
    'github.pulls.files': (raw) => {
      const params = raw as { nextToken?: string };
      if (params.nextToken && !filePageFailed) {
        filePageFailed = true;
        throw new Error('Fixture file page unavailable');
      }
      return params.nextToken
        ? {
            headSha: 'abc123',
            truncated: false,
            files: [
              {
                filename: 'assets/preview.png',
                previousFilename: null,
                status: 'modified',
                additions: 0,
                deletions: 0,
                changes: 0,
                patch: null,
              },
            ],
            nextToken: null,
          }
        : {
            headSha: 'abc123',
            truncated: false,
            files: [
              {
                filename: 'src/reconnect.ts',
                previousFilename: 'src/connect.ts',
                status: 'renamed',
                additions: 2,
                deletions: 1,
                changes: 3,
                patch:
                  '@@ -1 +1,2 @@\n-const connected = false;\n+const connected = true;\n+refreshWorkspace();',
              },
            ],
            nextToken: 'files-two',
          };
    },
    'github.listReviewComments': () => ({
      comments: [
        {
          id: 1,
          body:
            'Please preserve **focus** after refresh.\n\n<h2></h2>\n\n<h3>Bot findings</h3>\n\nLiteral `<h2></h2>` stays code.\n\n```html\n<h2>literal heading</h2>\n```\n\n<img src="x" onerror="window.__unsafeHomeHtml=true">\n\n' +
            Array.from(
              { length: 24 },
              (_, i) => `Finding ${i + 1}: preserve reviewer context.`,
            ).join('\n\n'),
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
