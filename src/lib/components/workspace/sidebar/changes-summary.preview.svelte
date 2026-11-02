<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    locked?: boolean;
    disclosures?: boolean;
    admittedOwner?: boolean;
    secondaryFiles?: boolean;
    prs?: 'single' | 'multiple' | 'many';
    scenario?: 'single' | 'staged' | 'mixed' | 'empty' | 'many' | 'loading';
    showRoots?: boolean;
    readOnly?: boolean;
    onNavigation?: (action: { type: string; payload: unknown }) => void;
  }
  export const preview = definePreview<Props>({
    id: 'changes-summary',
    title: 'Changes sidebar summary',
    defaultState: 'editable',
    states: {
      editable: { props: {} },
      disclosures: { props: { locked: true, disclosures: true } },
      locked: { props: { locked: true } },
      'single-pr': { props: { prs: 'single' } },
      'workspace-prs': { props: { prs: 'multiple', secondaryFiles: true } },
      'many-prs': { props: { prs: 'many' } },
      'single-file': { props: { showRoots: false } },
      staged: { props: { scenario: 'staged', showRoots: false } },
      mixed: { props: { scenario: 'mixed', locked: true } },
      empty: { props: { scenario: 'empty', showRoots: false } },
      many: { props: { scenario: 'many', locked: true } },
      loading: { props: { scenario: 'loading', showRoots: false } },
      'read-only': { props: { readOnly: true, scenario: 'mixed', locked: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import MultiSelectTabbedSidebar from '../MultiSelectTabbedSidebar.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    setWorkspaceEntity,
    removeWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    setChangesData,
    setCommitsData,
    setHasLoadedInitialData,
    setLoading,
  } from '$store/renderer/slices/changes/changes-slice';
  import { gitRootsUpdated } from '$store/renderer/slices/git-roots/git-roots-slice';
  import { setSecondaryRootGit } from '$store/renderer/slices/git/git-slice';
  import { setupChangesSummaryPreview } from '../../../../test/changes-summary-preview';
  import { ChangeStage } from '$features/file-tracking/types';
  import { PullRequestStatus, type PullRequestInfo } from '$shared/types';

  let {
    locked = false,
    disclosures = false,
    admittedOwner = true,
    secondaryFiles = false,
    prs,
    scenario = 'single',
    showRoots = true,
    readOnly = false,
    onNavigation,
  }: Props = $props();
  const workspaceId = 'changes-summary-preview';
  const timestamp = '2026-09-01T00:00:00Z';
  const branch = showRoots ? 'feature/a-long-working-branch-for-sidebar-layout' : 'polish-https';
  function pr(
    number: number,
    repo: string,
    title: string,
    status = PullRequestStatus.Open,
  ): PullRequestInfo {
    return {
      id: `${repo}-${number}`,
      number,
      title,
      status,
      url: `https://github.com/intent-hq/${repo}/pull/${number}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  const frontendPR = pr(42, 'cloudlands-fe', 'Show workspace pull requests in Changes');
  const backendPR = pr(42, 'intentd', 'Document the workspace PR list', PullRequestStatus.Draft);
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const disposePreview = untrack(() =>
    setupChangesSummaryPreview(workspaceId, branch, admittedOwner && !readOnly, onNavigation),
  );
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Changes summary',
      path: '/preview/workspace',
      repositoryPath: '/preview/repo',
      pullRequests: disclosures
        ? [
            {
              id: 'preview-pr',
              number: 42,
              title: 'Polish the sidebar',
              status: PullRequestStatus.Open,
              url: 'https://example.test/pull/42',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]
        : [],
      myRole: readOnly ? 'collaborator' : 'owner',
      branch,
      baseRef: 'main',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      repositoryOwner: 'intent-hq',
      repositoryName: 'intent',
      pullRequests: prs
        ? [
            pr(101, 'intent', 'Document workspace review workflow'),
            ...(prs !== 'single'
              ? [
                  frontendPR,
                  pr(
                    38,
                    'cloudlands-fe',
                    'Preserve repository identity for long pull request titles',
                    PullRequestStatus.Merged,
                  ),
                  pr(
                    35,
                    'intentd',
                    'Earlier draft of the review workflow',
                    PullRequestStatus.Closed,
                  ),
                ]
              : []),
            ...(prs === 'many'
              ? Array.from({ length: 12 }, (_, i) =>
                  pr(200 + i, 'intent', `Additional workspace pull request ${i + 1}`),
                )
              : []),
          ]
        : [],
    } as never),
  );
  const paths =
    scenario === 'many'
      ? Array.from(
          { length: 36 },
          (_, i) => `src/features/workspace/components/SidebarSection${i + 1}.svelte`,
        )
      : scenario === 'mixed'
        ? [
            'src/lib/components/workspace/sidebar/SidebarChangesPanel.svelte',
            'src/lib/styles/tokens.css',
            'yarn.lock',
          ]
        : ['yarn.lock'];
  const changes =
    scenario === 'empty' || scenario === 'loading'
      ? []
      : paths.map((path, index) => ({
          id: `change-${index}`,
          file: path,
          relativePath: path,
          status: 'modified' as const,
          stage:
            scenario === 'staged' || (scenario === 'mixed' && index > 0)
              ? ChangeStage.Staged
              : ChangeStage.Unstaged,
          stats: { additions: 4 + index, deletions: 1 },
          attribution: { manual: true, timestamp: 0 },
        }));
  store.dispatch(setChangesData(workspaceId, changes, false, changes.length));
  store.dispatch(setHasLoadedInitialData(workspaceId, scenario !== 'loading'));
  store.dispatch(setLoading(workspaceId, scenario === 'loading'));
  store.dispatch(
    gitRootsUpdated(
      workspaceId,
      showRoots
        ? [
            {
              id: 'summary-root',
              workspaceId,
              path: '/preview/workspace/packages/component',
              branch: 'feature/component',
              registeredCommitSha: disclosures ? 'older-component' : undefined,
              source: 'agent',
              createdAt: timestamp,
              updatedAt: timestamp,
              repoOwner: 'intent-hq',
              repoName: 'cloudlands-fe',
              pullRequests: prs && prs !== 'single' ? [frontendPR] : [],
            },
            ...(prs && prs !== 'single'
              ? [
                  {
                    id: 'backend-root',
                    workspaceId,
                    path: '/preview/workspace/packages/intentd',
                    branch: 'feature/guide',
                    source: 'agent' as const,
                    repoOwner: 'intent-hq',
                    repoName: 'intentd',
                    pullRequests: [backendPR],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                  },
                ]
              : []),
          ]
        : [],
    ),
  );
  store.dispatch(
    setSecondaryRootGit(workspaceId, 'summary-root', {
      status: {
        branch: 'feature/component',
        files: secondaryFiles
          ? [
              { path: 'collision.md', status: '?', staged: false },
              { path: 'tracked.txt', status: 'M', staged: false },
            ]
          : [],
        ahead: 0,
        behind: 0,
        isClean: !secondaryFiles,
      },
      commits: disclosures
        ? [
            {
              hash: 'new-component',
              message: 'Refine component controls',
              author: 'Preview',
              date: timestamp,
            },
            {
              hash: 'older-component',
              message: 'Set up component',
              author: 'Preview',
              date: timestamp,
            },
          ]
        : [],
      nextToken: undefined,
      commitFiles: disclosures
        ? {
            'new-component': [{ path: 'src/control.ts', additions: 6, deletions: 2 }],
            'older-component': [{ path: 'README.md', additions: 2, deletions: 0 }],
          }
        : {},
    } as never),
  );
  store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, ['changes']));
  $effect(() => {
    store.dispatch(
      setCommitsData(
        workspaceId,
        locked
          ? [
              {
                hash: 'abc123',
                message: 'Fixture commit',
                timestamp,
                author: 'Preview',
                isPushed: true,
                files: disclosures ? [{ path: 'src/control.ts', additions: 6, deletions: 2 }] : [],
              } as never,
            ]
          : [],
        scenario === 'loading' ? null : '0123456789abcdef',
      ),
    );
  });
  onDestroy(() => {
    disposePreview();
    store.dispatch(removeWorkspaceEntity(workspaceId));
    dispose();
  });
</script>

<div class="w-full h-[620px] bg-sidebar" data-testid="changes-summary-preview">
  <MultiSelectTabbedSidebar {workspaceId} />
</div>
