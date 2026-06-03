<script lang="ts">
  /**
   * Local Changes Tab Type Component
   *
   * Shows all local changes including staged, unstaged, and committed changes.
   * Includes staging controls and header actions.
   */

  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
  selectFileTrackingBoundarySha,
  selectFileTrackingChanges,
  selectFileTrackingCommits,
  selectFileTrackingLoading,
} from '$store/renderer/slices/changes/changes-selectors';
  import {
  stageByPathRequested,
  unstageByPathRequested,
  revertByPathRequested,
} from '$store/renderer/slices/changes/changes-slice';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import ChatChangesPanel from '$lib/components/chat/ChatChangesPanel.svelte';
  import { Button } from '$lib/components/ui/button';
  import {
  selectLineWrapping,
  selectFoldUnchanged,
  selectDiffSideBySide,
} from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
  toggleLineWrapping,
  toggleFoldUnchanged,
  toggleDiffSideBySide,
} from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import Fa from 'svelte-fa';
  import {
  faTextWidth,
  faMap,
  faColumns,
  faCompressAlt,
} from '@fortawesome/free-solid-svg-icons';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  const headerToggleActiveClass =
    'text-foreground bg-sidebar hover:text-foreground hover:bg-sidebar';
  const headerToggleInactiveClass = 'text-subtle';

  let { workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  const workspace = selectWorkspaceById(workspaceId);
  const workspacePath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || '');
  const ftChanges$ = selectFileTrackingChanges(workspaceId);
  const ftCommits$ = selectFileTrackingCommits(workspaceId);
  const ftBoundarySha$ = selectFileTrackingBoundarySha(workspaceId);
  const ftLoading$ = selectFileTrackingLoading(workspaceId);
  const allCommits = $derived($ftCommits$ || []);

  // State for expand/collapse and panel ref
  let changesAllExpanded = $state(true);
  let changesPanelRef = $state<{ expandAll: () => void; collapseAll: () => void } | null>(null);

  // Build the changes array with all local changes
  const localChangesForPanel = $derived.by(() => {
    const unstaged = $ftChanges$.filter((c) => c.stage === 'unstaged');
    const staged = $ftChanges$.filter((c) => c.stage === 'staged');
    return [
      ...unstaged.map((c) => {
        const rawPath = c.file || c.relativePath;
        const filePath = rawPath?.startsWith('/') ? rawPath : `${workspacePath}/${rawPath}`;
        return {
          filePath,
          action: 'modify' as const,
          additions: c.stats?.additions || 0,
          deletions: c.stats?.deletions || 0,
          toolName: 'local',
          toolCallId: `local-unstaged-${filePath}`,
          staged: false,
          category: 'unstaged' as const,
          oldContent: c.content?.oldContent,
          newContent: c.content?.newContent,
        };
      }),
      ...staged.map((c) => {
        const rawPath = c.file || c.relativePath;
        const filePath = rawPath?.startsWith('/') ? rawPath : `${workspacePath}/${rawPath}`;
        return {
          filePath,
          action: 'modify' as const,
          additions: c.stats?.additions || 0,
          deletions: c.stats?.deletions || 0,
          toolName: 'local',
          toolCallId: `local-staged-${filePath}`,
          staged: true,
          category: 'staged' as const,
          oldContent: c.content?.oldContent,
          newContent: c.content?.newContent,
        };
      }),
      ...allCommits.flatMap((commit) =>
        (commit.files || []).map(
          (file: { path?: string; additions?: number; deletions?: number } | string) => {
            const filePath = typeof file === 'string' ? file : file.path || '';
            const normalizedPath = filePath?.startsWith('/')
              ? filePath
              : `${workspacePath}/${filePath}`;
            const additions = typeof file === 'string' ? 0 : file.additions || 0;
            const deletions = typeof file === 'string' ? 0 : file.deletions || 0;
            return {
              filePath: normalizedPath,
              action: 'modify' as const,
              additions,
              deletions,
              toolName: 'local',
              toolCallId: `commit-${commit.hash}-${filePath}`,
              staged: false,
              category: 'committed' as const,
              commitHash: commit.hash,
              commitMessage: commit.message,
            };
          },
        ),
      ),
    ];
  });

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions(changesActions);
  });
</script>

{#snippet changesActions()}
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => {
      changesAllExpanded = !changesAllExpanded;
      if (changesAllExpanded) changesPanelRef?.expandAll();
      else changesPanelRef?.collapseAll();
    }}
    tooltip={changesAllExpanded ? 'Collapse all files' : 'Expand all files'}
    tooltipSide="bottom"
    aria-pressed={changesAllExpanded}
    class={changesAllExpanded ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faCompressAlt} size="xs" class={changesAllExpanded ? '' : 'rotate-180'} />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(toggleLineWrapping())}
    tooltip={$lineWrapping ? 'Wrapping lines. Click to disable.' : 'Click to wrap lines'}
    tooltipSide="bottom"
    aria-pressed={$lineWrapping}
    class={$lineWrapping ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faTextWidth} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(toggleFoldUnchanged())}
    tooltip={$foldUnchanged
      ? 'Folding unchanged lines. Click to disable.'
      : 'Click to fold unchanged lines'}
    tooltipSide="bottom"
    aria-pressed={$foldUnchanged}
    class={$foldUnchanged ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faMap} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(toggleDiffSideBySide())}
    tooltip={$diffSideBySide ? 'Click to show unified view' : 'Click to show split view'}
    tooltipSide="bottom"
    aria-pressed={$diffSideBySide}
    class={$diffSideBySide ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faColumns} size="xs" />
  </Button>
{/snippet}

<ChatChangesPanel
  bind:this={changesPanelRef}
  isLoading={$ftLoading$}
  changes={localChangesForPanel}
  branchBaseRef={$workspace?.baseRef ?? null}
  branchBaseCommitSha={$ftBoundarySha$ || $workspace?.baseCommitSha || null}
  showStagingControls={true}
  showCategoryFilter={true}
  onStage={(path) => appStore.dispatch(stageByPathRequested(workspaceId, [path]))}
  onUnstage={(path) => appStore.dispatch(unstageByPathRequested(workspaceId, [path]))}
  onRevert={(path) => appStore.dispatch(revertByPathRequested(workspaceId, [path]))}
  onStageAll={() => {
    const unstaged = $ftChanges$.filter((c) => c.stage === 'unstaged');
    const paths = unstaged.map((c) => {
      const rawPath = c.file || c.relativePath;
      return rawPath?.startsWith('/') ? rawPath : `${workspacePath}/${rawPath}`;
    });
    appStore.dispatch(stageByPathRequested(workspaceId, paths));
  }}
  onUnstageAll={() => {
    const staged = $ftChanges$.filter((c) => c.stage === 'staged');
    const paths = staged.map((c) => {
      const rawPath = c.file || c.relativePath;
      return rawPath?.startsWith('/') ? rawPath : `${workspacePath}/${rawPath}`;
    });
    appStore.dispatch(unstageByPathRequested(workspaceId, paths));
  }}
/>
