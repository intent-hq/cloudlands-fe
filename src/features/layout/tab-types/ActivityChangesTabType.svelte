<script lang="ts">
  /**
   * Activity Changes Tab Type Component
   *
   * Shows diff for a file from an activity event.
   * ALWAYS shows the historical diff from the event, not current git status.
   * Uses MonacoDiffViewer for consistent diff display with the sidebar changes panel.
   */

  import type { TabTypeComponentProps } from './registry';
  import type { WorkspaceEvent } from '$features/events/types';
  import { eventToTrackedChange } from '$features/file-tracking/change-converters';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';

  import MonacoDiffViewer from '$lib/components/file-tracking/MonacoDiffViewer.svelte';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { openTab, openTabInAdjacentOrSplit } from '$lib/store/slices/panel-layout/panel-layout-slice';
  import { selectFocusedPanelId } from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import { requestPanelFocus } from '$lib/store/slices/app-layout/app-layout-slice';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { selectLineWrapping, selectFoldUnchanged, selectDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { toggleLineWrapping, toggleFoldUnchanged, toggleDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { dispatch } from '$lib/store/redux-dispatch-bridge';
  import { patchToContents } from '$lib/utils/diff-utils';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import Fa from 'svelte-fa';
  import { faFile, faMap, faColumns, faTextWidth } from '@fortawesome/free-solid-svg-icons';
  import { createLogger } from '$lib/utils/client-logger';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();

  const logger = createLogger('ActivityChangesTabType');

  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();

  const workspace = selectWorkspaceById(workspaceId);
  const repoPath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || undefined);

  // Get the activity event from tab data
  const activityEvent = $derived(tab.data?.event as WorkspaceEvent | undefined);

  // Convert the event to tracked changes
  const activityChanges = $derived(activityEvent ? eventToTrackedChange(activityEvent) : []);
  const activityChange = $derived(activityChanges[0]);

  // Get the file path
  const filePath = $derived(activityChange?.relativePath || activityChange?.file || null);

  // Compute absolute path for "open in" actions
  const diffAbsolutePath = $derived(
    filePath && repoPath
      ? filePath.startsWith('/')
        ? filePath
        : `${repoPath}/${filePath}`
      : null,
  );

  // Extract the diff string from the event (try multiple locations)
  const diffString = $derived(() => {
    if (!activityEvent) return null;
    const data = activityEvent.data as any;
    const codeChange = (activityEvent as any).codeChange;
    return data?.diff || codeChange?.diff || activityChange?.content?.diff || null;
  });

  // Check if we have old/new content directly from the event
  const hasOldNewContent = $derived(() => {
    if (!activityChange?.content) return false;
    return !!(activityChange.content.oldContent && activityChange.content.newContent);
  });

  // Extract the starting line number from the first @@ hunk header in the patch
  function extractStartLine(patch: string | null): number | undefined {
    if (!patch) return undefined;
    const match = patch.match(/@@ -(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  // Reconstruct old/new content from the patch string (or use direct content if available)
  const diffContents = $derived.by(() => {
    // Prefer direct old/new content if available
    if (hasOldNewContent() && activityChange?.content) {
      return {
        oldContent: activityChange.content.oldContent ?? '',
        newContent: activityChange.content.newContent ?? '',
      };
    }
    // Otherwise reconstruct from patch string
    const patch = diffString();
    if (patch) {
      return patchToContents(patch);
    }
    return null;
  });

  // Get the starting line offset from the patch for correct line numbering
  const lineOffset = $derived(extractStartLine(diffString()));

  // Whether this is a partial file diff (starts after line 1)
  const isPartialDiff = $derived(lineOffset !== undefined && lineOffset > 1);

  // Build a TrackedChange with embedded content for MonacoDiffViewer
  const change: TrackedChange = $derived.by(() => {
    const path = filePath || '';
    const data = (activityEvent?.data || {}) as any;
    return {
      id: `activity-${activityEvent?.id || 'unknown'}-${path}`,
      file: path,
      relativePath: path,
      stage: ChangeStage.Committed,
      status: (activityChange?.status || 'modified') as any,
      stats: {
        additions: data?.additions || activityChange?.stats?.additions || 0,
        deletions: data?.deletions || activityChange?.stats?.deletions || 0,
      },
      attribution: { timestamp: activityEvent?.timestamp ? new Date(activityEvent.timestamp).getTime() : Date.now() },
      content: diffContents
        ? {
            oldContent: diffContents.oldContent,
            newContent: diffContents.newContent,
          }
        : undefined,
    };
  });

  // Open the file in the editor
  function handleGoToFile(e?: MouseEvent) {
    if (!filePath) return;
    const fileName = filePath.split('/').pop() || filePath;
    const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
    const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const tabData = {
      type: 'file' as const,
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    };
    const store = getReduxStore();
    if (openInAdjacentPanel) {
      store.dispatch(openTabInAdjacentOrSplit(workspaceId, tabData, sourcePanelId));
      const focusedId = selectFocusedPanelId.select(store.getState(), workspaceId);
      if (focusedId) {
        store.dispatch(requestPanelFocus(workspaceId, focusedId));
      }
    } else {
      store.dispatch(openTab(workspaceId, tabData));
    }
  }

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions(diffActions);
  });

  // Log what we're showing for debugging
  $effect(() => {
    if (activityEvent) {
      const data = activityEvent.data as any;
      logger.debug('Activity event diff info', {
        eventType: activityEvent.type,
        eventId: activityEvent.id,
        filePath,
        hasDiffString: !!diffString(),
        hasOldNewContent: hasOldNewContent(),
        hasDiffContents: !!diffContents,
        dataAdditions: data?.additions,
        dataDeletions: data?.deletions,
      });
    }
  });
</script>

{#snippet diffActions()}
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={handleGoToFile}
    tooltip="Go to file"
    tooltipSide="bottom"
  >
    <Fa icon={faFile} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => dispatch(toggleLineWrapping())}
    tooltip={$lineWrapping
      ? 'Wrapping lines. Click to disable.'
      : 'Click to wrap lines'}
    tooltipSide="bottom"
    class={$lineWrapping ? 'text-foreground' : 'text-muted-foreground'}
  >
    <Fa icon={faTextWidth} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => dispatch(toggleFoldUnchanged())}
    tooltip={$foldUnchanged
      ? 'Folding unchanged lines. Click to disable.'
      : 'Click to fold unchanged lines'}
    tooltipSide="bottom"
    class={$foldUnchanged ? 'text-foreground' : 'text-muted-foreground'}
  >
    <Fa icon={faMap} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => dispatch(toggleDiffSideBySide())}
    tooltip={$diffSideBySide
      ? 'Click to show unified view'
      : 'Click to show split view'}
    tooltipSide="bottom"
    class={$diffSideBySide ? 'text-foreground' : 'text-muted-foreground'}
  >
    <Fa icon={faColumns} size="xs" />
  </Button>
  {#if diffAbsolutePath}
    <OpenComboButton
      filePath={diffAbsolutePath}
      isDirectory={false}
      compact
      workspaceFolderPath={repoPath}
    />
  {/if}
{/snippet}

{#if filePath && diffContents}
  <div class="flex flex-col h-full">
    {#if isPartialDiff}
      <div class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-subtle bg-muted/50 border-b border-border">
        <span>Showing partial diff starting at line {lineOffset}</span>
      </div>
    {/if}
    <div class="flex-1 min-h-0">
      {#key `${activityEvent?.id}-${filePath}`}
        <MonacoDiffViewer
          {change}
          {workspaceId}
          sideBySide={$diffSideBySide}
          foldUnchanged={$foldUnchanged}
          lineWrapping={$lineWrapping}
          readOnly={true}
          {lineOffset}
        />
      {/key}
    </div>
  </div>
{:else if filePath}
  <!-- No diff content available -->
  <div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
    <p class="text-sm">No diff stored for this event</p>
    <p class="text-xs opacity-70">The file change was recorded but the diff was not captured</p>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
    <p class="text-sm">No changes found in this event</p>
    {#if activityEvent}
      <p class="text-xs opacity-70">Event type: {activityEvent.type}</p>
    {/if}
  </div>
{/if}
