/**
 * Visual scaffolding only: settled display inputs for all 16 source scene names.
 * GitHub values copy the checked-in fixtures plus source scene overrides.
 * GitLab values copy the contract fixture as displayed by the source observer.
 * No mock clients, intercepted requests, authority decisions or timers run here.
 * The source rate-limited hover/actions journey remains separately pending.
 * i18n-ignore (source fixture content, never production UI copy)
 */
import type { GitHubLinkCardProps } from './index';

export const githubLinkCardDisplayProvenance = {
  referenceCommit: '003bc52c00dcfffe8513cd6be1b8f45011716714',
  sourceScene: 'src/lib/components/ui/tooltip/github-link-card.preview.svelte',
  sourceSceneSha256: 'fc34aa2575b73c03c0df22a27d87a93d85b72b45ded5db1fc8c197c2959b30be',
  gitHubFixtureSource: 'src/lib/client/mock/fixtures/index.ts',
  gitLabFixtureSource: 'src/shared/types/__fixtures__/repository-resource-read.json',
  displayProjectionSource: 'src/lib/components/ui/tooltip/github-link-preview.ts',
  coverage: 'display-only; no live singleton, transport, integration-context, or cache coverage',
} as const;

export const githubLinkCardDisplayStates = {
  'gitlab-com-mr': {
    url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/42',
    preview: {
      status: 'ready',
      data: {
        provider: 'gitlab',
        resource: {
          repository: {
            provider: 'gitlab',
            instanceBaseUrl: 'https://gitlab.com',
            projectPath: 'gitlab-org/gitlab',
          },
          kind: 'merge-request',
          number: 42,
        },
        kind: 'pr',
        number: 42,
        title: 'Keep hover details on the original connection',
        state: 'open',
        author: 'mira',
        createdAt: '2026-10-01T09:00:00Z',
        updatedAt: '2026-10-02T02:00:00Z',
        url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/42',
        headRef: 'fix/original-connection',
        baseRef: 'main',
      },
    },
  },
  'gitlab-self-managed-mr': {
    url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/merge_requests/42',
    preview: {
      status: 'ready',
      data: {
        provider: 'gitlab',
        resource: {
          repository: {
            provider: 'gitlab',
            instanceBaseUrl: 'https://gitlab.example.test:8443/forge',
            projectPath: 'Team/Platform/api',
          },
          kind: 'merge-request',
          number: 42,
        },
        kind: 'pr',
        number: 42,
        title: 'Keep hover details on the original connection',
        state: 'open',
        author: 'mira',
        createdAt: '2026-10-01T09:00:00Z',
        updatedAt: '2026-10-02T02:00:00Z',
        url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/merge_requests/42',
        headRef: 'fix/original-connection',
        baseRef: 'main',
      },
    },
  },
  'gitlab-issue': {
    url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/issues/42',
    preview: {
      status: 'ready',
      data: {
        number: 42,
        title: 'Preserve issue identity in notes',
        state: 'open',
        url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/issues/42',
        author: 'mira',
        createdAt: '2026-10-01T09:00:00Z',
        updatedAt: '2026-10-02T02:00:00Z',
        provider: 'gitlab',
        resource: {
          repository: {
            provider: 'gitlab',
            instanceBaseUrl: 'https://gitlab.example.test:8443/forge',
            projectPath: 'Team/Platform/api',
          },
          kind: 'issue',
          number: 42,
        },
        kind: 'issue',
        headRef: null,
        baseRef: null,
      },
    },
  },
  'gitlab-loading': {
    url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/merge_requests/42',
    preview: {
      status: 'loading',
      resource: {
        repository: {
          provider: 'gitlab',
          instanceBaseUrl: 'https://gitlab.example.test:8443/forge',
          projectPath: 'Team/Platform/api',
        },
        kind: 'merge-request',
        number: 42,
      },
    },
  },
  'gitlab-restricted': {
    url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/issues/42',
    preview: {
      status: 'error',
      resource: {
        repository: {
          provider: 'gitlab',
          instanceBaseUrl: 'https://gitlab.example.test:8443/forge',
          projectPath: 'Team/Platform/api',
        },
        kind: 'issue',
        number: 42,
      },
      reason: 'resource-denied',
    },
  },
  'gitlab-unavailable': {
    url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/issues/42',
    preview: {
      status: 'error',
      resource: {
        repository: {
          provider: 'gitlab',
          instanceBaseUrl: 'https://gitlab.example.test:8443/forge',
          projectPath: 'Team/Platform/api',
        },
        kind: 'issue',
        number: 42,
      },
      reason: 'unavailable',
    },
  },
  'gitlab-rate-limited': {
    url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/merge_requests/42',
    preview: {
      status: 'error',
      resource: {
        repository: {
          provider: 'gitlab',
          instanceBaseUrl: 'https://gitlab.example.test:8443/forge',
          projectPath: 'Team/Platform/api',
        },
        kind: 'merge-request',
        number: 42,
      },
      reason: 'rate-limited',
    },
  },
  'gitlab-unknown': {
    url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/merge_requests/42',
    preview: {
      status: 'ready',
      data: {
        provider: 'gitlab',
        resource: {
          repository: {
            provider: 'gitlab',
            instanceBaseUrl: 'https://gitlab.example.test:8443/forge',
            projectPath: 'Team/Platform/api',
          },
          kind: 'merge-request',
          number: 42,
        },
        kind: 'pr',
        number: 42,
        title: 'Keep hover details on the original connection',
        state: 'unknown',
        author: null,
        createdAt: '2026-10-01T09:00:00Z',
        updatedAt: null,
        url: 'https://gitlab.example.test:8443/forge/Team/Platform/api/-/merge_requests/42',
        headRef: 'fix/original-connection',
        baseRef: 'main',
      },
    },
  },
  loading: {
    url: 'https://github.com/acme/web-app/pull/42',
    preview: {
      status: 'loading',
    },
  },
  'pr-open': {
    url: 'https://github.com/acme/web-app/pull/42',
    preview: {
      status: 'ready',
      data: {
        kind: 'pr',
        owner: 'acme',
        repo: 'web-app',
        number: 42,
        title: 'Add dark mode toggle to the settings panel',
        state: 'open',
        author: 'octocat',
        createdAt: '2026-01-02T09:00:00.000Z',
        updatedAt: '2026-01-02T14:00:00.000Z',
        url: 'https://github.com/acme/web-app/pull/42',
        headRef: 'feat/dark-mode-toggle',
        baseRef: 'main',
      },
    },
  },
  'pr-merged': {
    url: 'https://github.com/acme/web-app/pull/43',
    preview: {
      status: 'ready',
      data: {
        kind: 'pr',
        owner: 'acme',
        repo: 'web-app',
        number: 43,
        title: 'Add dark mode toggle to the settings panel',
        state: 'merged',
        author: 'octocat',
        createdAt: '2026-01-02T09:00:00.000Z',
        updatedAt: '2026-01-03T09:30:00.000Z',
        url: 'https://github.com/acme/web-app/pull/43',
        headRef: 'fix/theme-flash',
        baseRef: 'main',
      },
    },
  },
  'pr-queued': {
    url: 'https://github.com/acme/web-app/pull/45',
    preview: {
      status: 'ready',
      data: {
        kind: 'pr',
        owner: 'acme',
        repo: 'web-app',
        number: 45,
        title: 'Persist sidebar width across sessions',
        state: 'queued',
        author: 'octocat',
        createdAt: '2026-01-03T09:00:00.000Z',
        updatedAt: '2026-01-03T15:30:00.000Z',
        url: 'https://github.com/acme/web-app/pull/45',
        headRef: 'feat/persist-sidebar-width',
        baseRef: 'main',
      },
    },
  },
  'pr-draft': {
    url: 'https://github.com/acme/web-app/pull/44',
    preview: {
      status: 'ready',
      data: {
        kind: 'pr',
        owner: 'acme',
        repo: 'web-app',
        number: 44,
        title:
          'Rework the settings navigation so that every section is reachable from the keyboard and screen readers announce the active pane',
        state: 'draft',
        author: 'octocat',
        createdAt: '2026-01-02T09:00:00.000Z',
        updatedAt: '2026-01-02T14:00:00.000Z',
        url: 'https://github.com/acme/web-app/pull/44',
        headRef: 'feat/settings-navigation-a11y-rework',
        baseRef: 'main',
      },
    },
  },
  'issue-closed': {
    url: 'https://github.com/acme/web-app/issues/17',
    preview: {
      status: 'ready',
      data: {
        kind: 'issue',
        owner: 'acme',
        repo: 'web-app',
        number: 17,
        title: 'Theme flashes light mode on first paint',
        state: 'closed',
        author: 'octocat',
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
        url: 'https://github.com/acme/web-app/issues/17',
      },
    },
  },
  error: {
    url: 'https://github.com/acme/web-app/pull/404',
    preview: {
      status: 'error',
      reason: 'unavailable',
    },
  },
  'rate-limited': {
    url: 'https://github.com/acme/web-app/pull/42',
    preview: {
      status: 'error',
      reason: 'rate-limited',
    },
  },
} satisfies Record<string, GitHubLinkCardProps>;

export type GitHubLinkCardDisplayState = keyof typeof githubLinkCardDisplayStates;
