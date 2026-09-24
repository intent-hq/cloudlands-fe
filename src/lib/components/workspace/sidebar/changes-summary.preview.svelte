<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    locked?: boolean;
    collapsed?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'changes-summary',
    title: 'Changes sidebar summary',
    defaultState: 'editable',
    states: {
      editable: { props: {} },
      locked: { props: { locked: true } },
      rail: { props: { collapsed: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import MultiSelectTabbedSidebar from '../MultiSelectTabbedSidebar.svelte';
  import WorkspaceLayout from '../WorkspaceLayout.svelte';
  import { setCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-slice';
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
  } from '$store/renderer/slices/changes/changes-slice';
  import { gitRootsUpdated } from '$store/renderer/slices/git-roots/git-roots-slice';
  import { setSecondaryRootGit } from '$store/renderer/slices/git/git-slice';
  import { installChangesSummaryMocks } from './changes-summary.preview-fixtures';
  import { ChangeStage } from '$features/file-tracking/types';

  let { locked = false, collapsed = false }: Props = $props();
  const workspaceId = 'changes-summary-preview';
  const timestamp = '2026-09-01T00:00:00Z';
  const branch = 'feature/a-long-working-branch-for-sidebar-layout';
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const restoreMocks = installChangesSummaryMocks(workspaceId, branch);
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Changes summary',
      path: '/preview/workspace',
      repositoryPath: '/preview/repo',
      branch,
      baseRef: 'main',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(
    setChangesData(
      workspaceId,
      [
        {
          id: 'change-1',
          file: 'src/sidebar.ts',
          relativePath: 'src/sidebar.ts',
          status: 'modified',
          stage: ChangeStage.Unstaged,
          stats: { additions: 4, deletions: 1 },
          attribution: { manual: true, timestamp: 0 },
        },
      ],
      false,
      1,
    ),
  );
  store.dispatch(setHasLoadedInitialData(workspaceId, true));
  store.dispatch(
    gitRootsUpdated(workspaceId, [
      {
        id: 'summary-root',
        workspaceId,
        path: '/preview/workspace/packages/component',
        branch: 'feature/component',
        source: 'agent',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]),
  );
  store.dispatch(
    setSecondaryRootGit(workspaceId, 'summary-root', {
      status: { branch: 'feature/component', files: [], ahead: 0, behind: 0, isClean: true },
      commits: [],
      nextToken: undefined,
      commitFiles: {},
    } as never),
  );
  store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, ['changes']));
  $effect(() => {
    store.dispatch(setCollapsed(collapsed));
  });
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
                files: [],
              } as never,
            ]
          : [],
        null,
      ),
    );
  });
  onDestroy(() => {
    store.dispatch(setCollapsed(false));
    restoreMocks();
    store.dispatch(removeWorkspaceEntity(workspaceId));
    dispose();
  });
</script>

<div class="w-full h-[620px] bg-sidebar" data-testid="changes-summary-preview">
  {#if collapsed}
    <WorkspaceLayout>
      {#snippet sidebar(isCollapsed = false)}
        <MultiSelectTabbedSidebar {workspaceId} collapsed={isCollapsed} />
      {/snippet}
      {#snippet content()}<div class="h-full w-full bg-background"></div>{/snippet}
    </WorkspaceLayout>
  {:else}
    <MultiSelectTabbedSidebar {workspaceId} />
  {/if}
</div>
