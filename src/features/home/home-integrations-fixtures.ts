import { emptyHomeIntegrations } from './home-integrations-slice';
import type {
  HomeIntegrationItem,
  HomeIntegrationsState,
  HomePullCheck,
} from './home-integrations-types';

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
const mixedChecks: HomePullCheck[] = [
  { name: 'CI Gate', state: 'pending', url: null },
  ...Array.from({ length: 3 }, (_, index): HomePullCheck => ({
    name: `Component tests / Browser interactions (shard ${index + 1}/3)`,
    state: 'pending',
    url: null,
  })),
  { name: 'Lint', state: 'failure', url: 'https://github.com/acme/studio/actions/runs/1' },
  { name: 'Integration tests', state: 'cancelled', url: null },
  ...['Typecheck', 'Build', 'Architecture', 'Translations', 'Formatting'].map(
    (name): HomePullCheck => ({ name, state: 'success', url: null }),
  ),
  ...['macOS build', 'Windows build', 'Release preview'].map((name): HomePullCheck => ({
    name,
    state: 'neutral',
    url: null,
  })),
];
const longFiles: HomeIntegrationsState['files'] = [
  {
    filename: 'src/features/home/HomePullCode.svelte',
    status: 'modified',
    additions: 240,
    deletions: 1,
    patch: `@@ -1 +1,240 @@\n-const selected = null;\n${Array.from(
      { length: 240 },
      (_, index) =>
        `+const file${index + 1} = ${index === 0 ? JSON.stringify('A long line that stays readable with horizontal scrolling. '.repeat(8)) : index + 1};`,
    ).join('\n')}`,
    url: 'https://github.com/acme/studio/blob/fixture-head/src/features/home/HomePullCode.svelte',
  },
  {
    filename: 'src/features/home/renamed file.ts',
    previousFilename: 'src/features/home/previous file.ts',
    status: 'renamed',
    additions: 1,
    deletions: 1,
    patch: '@@ -1 +1 @@\n-export const title = "Previous";\n+export const title = "Renamed";',
  },
  {
    filename: 'src/features/home/new-file.ts',
    status: 'added',
    additions: 1,
    deletions: 0,
    patch: '@@ -0,0 +1 @@\n+export const ready = true;',
  },
  {
    filename: 'src/features/home/removed-file.ts',
    status: 'removed',
    additions: 0,
    deletions: 1,
    patch: '@@ -1 +0,0 @@\n-export const obsolete = true;',
  },
  {
    filename: 'README.md',
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: '@@ -1 +1,2 @@\n # Workspace\n+Keep your context.',
  },
  {
    filename:
      'src/features/workspace/very/deeply/nested/directories/with/descriptive/names/a-very-long-filename-that-must-stay-operable-in-a-narrow-panel.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: '@@ -1 +1 @@\n-export const open = false;\n+export const open = true;',
  },
  prs.files[1]!,
  ...Array.from({ length: 12 }, (_, index) => ({
    filename: `src/features/home/fixtures/example-${index + 1}.ts`,
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: '@@ -1 +1 @@\n-export const open = false;\n+export const open = true;',
  })),
];
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
  'checks-mixed': { ...prs, reviewData: { ...prs.reviewData!, checks: mixedChecks } },
  'checks-passed': {
    ...prs,
    reviewData: {
      ...prs.reviewData!,
      checks: mixedChecks.filter((check) => check.state === 'success'),
    },
  },
  'checks-neutral': {
    ...prs,
    reviewData: {
      ...prs.reviewData!,
      checks: mixedChecks.filter((check) => check.state === 'neutral'),
    },
  },
  'checks-cancelled': {
    ...prs,
    reviewData: {
      ...prs.reviewData!,
      checks: mixedChecks.filter((check) => check.state === 'cancelled'),
    },
  },
  'checks-empty': { ...prs, reviewData: { ...prs.reviewData!, checks: [] } },
  'checks-loading': { ...prs, reviewData: null, checksLoading: true },
  'checks-error': {
    ...prs,
    checksError: 'Checks could not be refreshed. Your last results are preserved.',
  },
  'files-long': {
    ...prs,
    detail: { ...pull, changedFiles: longFiles.length },
    reviewData: { ...prs.reviewData!, changedFiles: longFiles.length },
    files: longFiles,
  },
  'files-empty': { ...prs, detail: { ...pull, changedFiles: 0 }, files: [] },
};
