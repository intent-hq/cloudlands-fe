<script lang="ts">
  /**
   * Activity Changes Tab Type Component
   *
   * Shows diff for a file from an activity event.
   * ALWAYS shows the historical diff from the event, not current git status.
   * Uses TrackedChangeDiffViewer for consistent diff display with the sidebar changes panel.
   */

  import type { TabTypeComponentProps } from './registry';
  import type { WorkspaceEvent } from '$features/events/types';
  import { eventToTrackedChange } from '$features/file-tracking/change-converters';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';

  import { TrackedChangeDiffViewer } from '$features/file-tracking/components/diff';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { openTabInRightmostColumnRequested } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
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

  import { patchToContents } from '$lib/utils/diff-utils';
  import * as Menu from '$lib/components/ui/menu';
  import ViewSettingsDropdown from '../components/ViewSettingsDropdown.svelte';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import { faFile } from '@fortawesome/free-solid-svg-icons';
  import { createLogger } from '$lib/utils/client-logger';
  import { isAbsolutePath } from '$lib/utils/path-utils';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  const logger = createLogger('ActivityChangesTabType');

  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();

  // svelte-ignore state_referenced_locally
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
    filePath && repoPath ? (isAbsolutePath(filePath) ? filePath : `${repoPath}/${filePath}`) : null,
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

  // Build a TrackedChange with embedded content for TrackedChangeDiffViewer
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
      attribution: {
        timestamp: activityEvent?.timestamp
          ? new Date(activityEvent.timestamp).getTime()
          : Date.now(),
      },
      content: diffContents
        ? {
            oldContent: diffContents.oldContent,
            newContent: diffContents.newContent,
          }
        : undefined,
    };
  });

  // Open the file in the editor
  function handleGoToFile(_event?: MouseEvent) {
    if (!filePath) return;
    const fileName = filePath.split('/').pop() || filePath;
    const tabData = {
      type: 'file' as const,
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    };
    const store = appStore;
    store.dispatch(openTabInRightmostColumnRequested(workspaceId, tabData));
  }

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions({ display: diffDisplayActions, actions: diffActions });
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

{#snippet diffDisplayActions()}
  <ViewSettingsDropdown
    embedded
    foldEnabled={$foldUnchanged}
    onToggleFold={() => appStore.dispatch(toggleFoldUnchanged())}
    wrapEnabled={$lineWrapping}
    onToggleWrap={() => appStore.dispatch(toggleLineWrapping())}
    splitEnabled={$diffSideBySide}
    onToggleSplit={() => appStore.dispatch(toggleDiffSideBySide())}
  />
{/snippet}

{#snippet diffActions()}
  <Menu.CommandItem
    icon={faFile}
    label={m.layout_diffHeader_goToFile_tooltip()}
    onclick={(event) => handleGoToFile(event)}
  />
  {#if diffAbsolutePath}
    <OpenComboButton
      filePath={diffAbsolutePath}
      {workspaceId}
      isDirectory={false}
      embedded
      workspaceFolderPath={repoPath}
    />
  {/if}
{/snippet}

{#if filePath && diffContents}
  <div class="flex flex-col h-full">
    {#if isPartialDiff}
      <div
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-subtle bg-muted/50 border-b border-border"
      >
        <span>{m.layout_activityChanges_partialDiff_label({ line: lineOffset ?? 0 })}</span>
      </div>
    {/if}
    <div class="flex-1 min-h-0">
      {#key `${activityEvent?.id}-${filePath}`}
        <TrackedChangeDiffViewer
          {change}
          {workspaceId}
          viewMode={$diffSideBySide ? 'split' : 'unified'}
          foldUnchanged={$foldUnchanged}
          lineWrapping={$lineWrapping}
          {lineOffset}
        />
      {/key}
    </div>
  </div>
{:else if filePath}
  <!-- No diff content available -->
  <div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
    <p class="text-sm">{m.layout_activityChanges_noDiffStored_label()}</p>
    <p class="text-xs opacity-70">{m.layout_activityChanges_diffNotCaptured_description()}</p>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
    <p class="text-sm">{m.layout_activityChanges_noChanges_label()}</p>
    {#if activityEvent}
      <p class="text-xs opacity-70">
        {m.layout_activityChanges_eventType_label({ type: activityEvent.type })}
      </p>
    {/if}
  </div>
{/if}
