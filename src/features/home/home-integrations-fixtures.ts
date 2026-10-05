import { emptyHomeIntegrations } from './home-integrations-slice';
import type { HomeIntegrationItem, HomeIntegrationsState } from './home-integrations-types';

const pull: HomeIntegrationItem = {
  id: 'acme/studio#142',
  identifier: '#142',
  number: 142,
  owner: 'acme',
  repo: 'studio',
  title: 'Keep workspace previews in sync after reconnect',
  state: 'open',
  url: 'https://github.com/acme/studio/pull/142',
  author: 'avery',
  updatedAt: '2026-09-28T22:10:00Z',
  description:
    '## What changed\n\nWorkspace previews now refresh when the connection returns.\n\n- Preserve the selected workspace\n- Refresh status and task progress\n\n```ts\nrefreshWorkspace(workspaceId);\n```',
  headRef: 'fix/workspace-reconnect',
  baseRef: 'main',
  additions: 128,
  deletions: 34,
  changedFiles: 5,
  labels: ['frontend', 'ready for review'],
};
const issue: HomeIntegrationItem = {
  id: 'fixture-linear-1',
  identifier: 'DES-318',
  title: 'Make workspace attention states easier to scan',
  url: 'https://linear.app/example/issue/DES-318',
  state: 'In progress',
  author: 'Avery Morgan',
  team: 'Design Engineering',
  assignee: 'Jordan Lee',
  priority: 2,
  project: 'Workspace clarity',
  updatedAt: '2026-09-28T21:20:00Z',
  labels: ['UX'],
  description:
    '## Goal\n\nHelp people find work that needs their attention.\n\n### Acceptance criteria\n\n- Keep status labels readable\n- Explain blocked work\n- Support keyboard navigation',
};
const prs: HomeIntegrationsState = {
  ...emptyHomeIntegrations,
  status: 'ready',
  scope: {
    kind: 'prs',
    repositories: [{ key: 'acme/studio', owner: 'acme', name: 'studio' }],
  },
  items: [
    pull,
    {
      ...pull,
      id: 'acme/studio#141',
      number: 141,
      identifier: '#141',
      url: 'https://github.com/acme/studio/pull/141',
      title: 'Add repository keyboard navigation',
      state: 'draft',
      description: '',
    },
    {
      ...pull,
      id: 'acme/platform#140',
      repo: 'platform',
      number: 140,
      identifier: '#140',
      url: 'https://github.com/acme/platform/pull/140',
      title: 'Handle service reconnects',
      state: 'closed',
    },
  ],
  selectedId: pull.id,
  detail: pull,
  cursors: ['fixture-next-page'],
  reviewData: {
    headSha: 'fixture-head',
    additions: 128,
    deletions: 34,
    changedFiles: 5,
    requestedReviewers: ['sam'],
    checks: [
      { name: 'Typecheck', state: 'success', url: null },
      { name: 'Browser tests', state: 'pending', url: null },
    ],
    reviews: [
      {
        id: 11,
        author: 'jordan',
        state: 'APPROVED',
        body: 'Selection survives reconnect. Looks good!',
        submittedAt: pull.updatedAt,
        url: pull.url + '#pullrequestreview-11',
      },
    ],
  },
  filesHeadSha: 'fixture-head',
  files: [
    {
      filename: 'src/reconnect.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      patch:
        '@@ -1 +1,2 @@\n-const connected = false;\n+const connected = true;\n+refreshWorkspace();',
    },
    { filename: 'assets/preview.png', status: 'modified', additions: 0, deletions: 0, patch: null },
  ],
  comments: [
    {
      id: 1,
      body: 'Could we preserve the selection when **refreshing** this list?',
      path: 'src/features/home/Home.svelte',
      line: 42,
      user: { login: 'jordan' },
      htmlUrl: 'https://github.com/acme/studio/pull/142#discussion_r1',
    },
  ],
};
const linear: HomeIntegrationsState = {
  ...emptyHomeIntegrations,
  status: 'ready',
  filter: 'assigned',
  scope: { kind: 'linear', repositories: [] },
  items: [
    issue,
    {
      ...issue,
      id: 'fixture-linear-2',
      identifier: 'ENG-92',
      title: 'Document reconnect recovery',
      team: 'Platform',
      priority: 0,
      state: 'Backlog',
      description: '',
    },
  ],
  selectedId: issue.id,
  detail: issue,
};
/** Deterministic, opt-in browser fixtures; production never imports this module. */
export const homeIntegrationsFixtures: Record<string, HomeIntegrationsState> = {
  prs,
  linear,
  empty: { ...prs, items: [], selectedId: null, detail: null, comments: [], cursors: [] },
  disconnected: { ...emptyHomeIntegrations, status: 'disconnected' },
  error: {
    ...emptyHomeIntegrations,
    status: 'error',
    error: 'The service could not be reached. Retry when your connection returns.',
  },
  loading: { ...emptyHomeIntegrations, status: 'loading' },
  'detail-error': {
    ...prs,
    detail: null,
    detailError: 'This pull request is no longer accessible.',
  },
  'comments-error': { ...prs, comments: [], commentsError: 'Review comments could not be loaded.' },
  'pagination-error': {
    ...prs,
    error: 'The next page could not be loaded. Your current results are preserved.',
  },
};
