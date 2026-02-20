<script lang="ts">
  /**
   * Local Changes Tab Type Component
   *
   * Shows all local changes including staged, unstaged, and committed changes.
   * Includes staging controls and header actions.
   */

  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import ChatChangesPanel from '$lib/components/chat/ChatChangesPanel.svelte';
  import { Button } from '$lib/components/ui/button';
  import { editorSettings } from '$lib/stores/editor-settings.store.svelte';
  import Fa from 'svelte-fa';
  import { faTextWidth, faMap, faColumns, faCompressAlt } from '@fortawesome/free-solid-svg-icons';

  let { workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  const workspace = $derived(workspaceStore.findById(WorkspaceId(workspaceId)));
  const workspacePath = $derived(workspace?.worktreePath || workspace?.repositoryPath || '');
  const allCommits = $derived(fileTrackingStore.commits || []);

  // State for expand/collapse and panel ref
  let changesAllExpanded = $state(true);
  let changesPanelRef = $state<{ expandAll: () => void; collapseAll: () => void } | null>(null);

  // Build the changes array with all local changes
  const localChangesForPanel = $derived.by(() => {
    const unstaged = fileTrackingStore.changes.filter((c) => c.stage === 'unstaged');
    const staged = fileTrackingStore.changes.filter((c) => c.stage === 'staged');
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
  <Button variant="ghost-light" size="icon-xs"
    onclick={() => {
      changesAllExpanded = !changesAllExpanded;
      if (changesAllExpanded) changesPanelRef?.expandAll();
      else changesPanelRef?.collapseAll();
    }}
    tooltip={changesAllExpanded ? 'Collapse all files' : 'Expand all files'} tooltipSide="bottom"
    class={changesAllExpanded ? 'text-foreground' : 'text-muted-foreground/50'}>
    <Fa icon={faCompressAlt} size="xs" class={changesAllExpanded ? '' : 'rotate-180'} />
  </Button>
  <Button variant="ghost-light" size="icon-xs" onclick={() => editorSettings.toggleLineWrapping()}
    tooltip={editorSettings.lineWrapping ? 'Wrapping lines. Click to disable.' : 'Click to wrap lines'}
    tooltipSide="bottom" class={editorSettings.lineWrapping ? 'text-foreground' : 'text-muted-foreground/50'}>
    <Fa icon={faTextWidth} size="xs" />
  </Button>
  <Button variant="ghost-light" size="icon-xs" onclick={() => editorSettings.toggleFoldUnchanged()}
    tooltip={editorSettings.foldUnchanged ? 'Folding unchanged lines. Click to disable.' : 'Click to fold unchanged lines'}
    tooltipSide="bottom" class={editorSettings.foldUnchanged ? 'text-foreground' : 'text-muted-foreground/50'}>
    <Fa icon={faMap} size="xs" />
  </Button>
  <Button variant="ghost-light" size="icon-xs" onclick={() => editorSettings.toggleDiffSideBySide()}
    tooltip={editorSettings.diffSideBySide ? 'Click to show unified view' : 'Click to show split view'}
    tooltipSide="bottom" class={editorSettings.diffSideBySide ? 'text-foreground' : 'text-muted-foreground/50'}>
    <Fa icon={faColumns} size="xs" />
  </Button>
{/snippet}

<ChatChangesPanel
  bind:this={changesPanelRef}
  showHeader={false}
  isLoading={fileTrackingStore.loading}
  changes={localChangesForPanel}
  title="All Changes in Space"
  showStagingControls={true}
  showCategoryFilter={true}
  onStage={(path) => fileTrackingStore.stageByPath([path])}
  onUnstage={(path) => fileTrackingStore.unstageByPath([path])}
  onRevert={(path) => fileTrackingStore.revertByPath([path])}
  onStageAll={() => {
    const unstaged = fileTrackingStore.changes.filter((c) => c.stage === 'unstaged');
    const paths = unstaged.map((c) => {
      const rawPath = c.file || c.relativePath;
      return rawPath?.startsWith('/') ? rawPath : `${workspacePath}/${rawPath}`;
    });
    fileTrackingStore.stageByPath(paths);
  }}
  onUnstageAll={() => {
    const staged = fileTrackingStore.changes.filter((c) => c.stage === 'staged');
    const paths = staged.map((c) => {
      const rawPath = c.file || c.relativePath;
      return rawPath?.startsWith('/') ? rawPath : `${workspacePath}/${rawPath}`;
    });
    fileTrackingStore.unstageByPath(paths);
  }}
  onClose={() => {
    window.dispatchEvent(new CustomEvent('close-local-changes'));
  }}
/>
