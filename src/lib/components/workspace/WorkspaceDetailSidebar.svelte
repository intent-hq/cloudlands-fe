<script lang="ts">
  import type { Workspace, Note } from '$shared/types';
  import type { TrackedChange } from '$features/file-tracking/types';
  import type { WorkspaceEvent } from '$features/events/types';
  import type { LocalCommitInfo } from '$features/accept-changes/types';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import { cn } from '$lib/utils';
  import {
    SidebarToggle,
    NotesPanel,
    FilesPanel,
    CodeChangesPanel,
    ActivityLogPreview,
    WorkspaceProgressCard,
    isSpecNote,
  } from './sidebar';
  import { noteReadTrackingStore } from '$lib/stores/note-read-tracking.store.svelte';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faList,
    faFolderTree,
    faPlus,
    faArrowRight,
    faFile,
    faCodeBranch,
    faEdit,
    faPen,
    faPenAlt,
  } from '@fortawesome/free-solid-svg-icons';
  import { paletteStore } from '$features/palette/palette.store.svelte';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';

  interface Props {
    workspace: Workspace;
    workspaceId: string;
    workspacePath?: string;
    // Notes
    notes?: Note[];
    selectedNoteId?: string | null;
    onOpenNote?: (noteId: string) => void;
    onReorderNotes?: (noteIds: string[]) => void;
    onCreateNote?: () => void;
    // Files
    selectedFile?: string | null;
    onOpenFile?: (filePath: string) => void;
    // Code changes
    unstagedChanges?: TrackedChange[];
    stagedChanges?: TrackedChange[];
    selectedChangeId?: string | null;
    onOpenChange?: (change: TrackedChange) => void;
    onStageChange?: (change: TrackedChange) => void;
    onUnstageChange?: (change: TrackedChange) => void;
    onRevertChange?: (change: TrackedChange) => void;
    onAcceptChanges?: () => void;
    isAcceptChangesOpen?: boolean;
    // Git state
    commits?: LocalCommitInfo[];
    unpushedCount?: number;
    pullRequests?: PRInfo[];
    currentBranch?: string;
    isNewWorkspaceSession?: boolean;
    onOpenCommit?: (hash: string) => void;
    onOpenPR?: (url: string) => void;
    // Activity
    recentActivity?: WorkspaceEvent[];
    onViewAllActivity?: () => void;
    onOpenActivityEvent?: (event: WorkspaceEvent) => void;
    // Dashboard
    onOpenDashboard?: () => void;
    // Agent creation
    onCreateAgentWithPrompt?: (prompt: string, name: string) => void;
    // Browser
    onOpenUrl?: (url: string) => void;
    // Loading states
    isChangesLoading?: boolean;
    // Layout
    class?: string;
  }

  let {
    workspace,
    workspaceId,
    workspacePath = '',
    notes = [],
    selectedNoteId = null,
    onOpenNote,
    onReorderNotes,
    onCreateNote,
    selectedFile = null,
    onOpenFile,
    unstagedChanges = [],
    stagedChanges = [],
    selectedChangeId = null,
    onOpenChange,
    onStageChange,
    onUnstageChange,
    onRevertChange,
    onAcceptChanges,
    isAcceptChangesOpen = false,
    commits = [],
    unpushedCount = 0,
    pullRequests = [],
    currentBranch: _currentBranch = '',
    isNewWorkspaceSession = false,
    onOpenCommit,
    onOpenPR,
    recentActivity = [],
    onViewAllActivity,
    onOpenActivityEvent,
    onOpenDashboard: _onOpenDashboard,
    onCreateAgentWithPrompt,
    onOpenUrl: _onOpenUrl,
    isChangesLoading = false,
    class: className,
  }: Props = $props();

  // Tab state for Files/Code Changes toggle (default to changes)
  let codeTab: 'files' | 'changes' = $state('changes');

  // View mode for code changes list
  let viewMode: 'list' | 'tree' = $state('list');

  // Filter to show only changed files in the file tree
  let showOnlyChangedFiles = $state(false);

  // Check if we have any code changes to show
  const hasChanges = $derived(unstagedChanges.length > 0 || stagedChanges.length > 0);
  const hasCommits = $derived(commits.length > 0 || unpushedCount > 0);
  const hasPRs = $derived(pullRequests.length > 0);
  const hasCodeSection = $derived(hasChanges || hasCommits || hasPRs);

  // Combined changes for display (staged first, then unstaged)
  const allChanges = $derived([...stagedChanges, ...unstagedChanges]);
  const totalChanges = $derived(allChanges.length);

  // Hover state for file change icons
  let hoveredChangeId: string | null = $state(null);

  // Determine change type: new file has only additions, deleted has only deletions
  function getChangeType(change: TrackedChange): 'added' | 'deleted' | 'modified' {
    const { additions, deletions } = change.stats;
    if (additions > 0 && deletions === 0) return 'added';
    if (deletions > 0 && additions === 0) return 'deleted';
    return 'modified';
  }

  // Single effect to refresh unread notes - this is the ONLY place that triggers the refresh
  // NotesPanel and WorkspaceProgressCard just read from the store reactively
  $effect(() => {
    if (workspaceId && notes.length > 0) {
      // Track ALL notes for unread status, not just task notes
      // Exclude the spec note since it's always visible and doesn't need unread tracking
      const trackableNotes = notes.filter((n) => !isSpecNote(n.id as string));
      const notesWithTimestamps = trackableNotes.map((n) => ({
        id: n.id as string,
        // Use createdAt as fallback - NEVER use new Date() as it causes false positives
        updatedAt: n.updatedAt || n.updated_at || n.createdAt || n.created_at || '',
        createdAt: n.createdAt || n.created_at,
      }));
      noteReadTrackingStore.refreshUnreadNotes(workspaceId, notesWithTimestamps);
    }
  });
</script>

<div class={cn('flex flex-col h-full bg-sidebar pt-2 pr-2', className)}>
  <!-- Workspace Progress Card (includes header) -->
  <div class="shrink-0 px-4 pt-1.5 pb-4">
    <WorkspaceProgressCard {notes} {workspace} {workspaceId} {onOpenNote} {onAcceptChanges} />
  </div>

  {#if !isNewWorkspaceSession}
    <!-- Notes Section (resizable) -->
    <ResizablePanel
      orientation="vertical"
      edge="bottom"
      minHeight={80}
      maxHeight={600}
      defaultHeight={350}
      storageKey="sidebar-notes-height"
      percentageWeight={0.5}
      className="w-full flex flex-col min-h-0 group/notes shrink-0 mb-1.5"
    >
      <div class="shrink-0 px-4 pt-2 relative z-10 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            Notes
          </span>
        </div>
        {#if onCreateNote}
          <button
            onclick={onCreateNote}
            class="opacity-0 group-hover/notes:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
            title="New note"
          >
            <Fa icon={faPlus} size="xs" />
          </button>
        {/if}
      </div>
      <div class="overflow-y-auto overflow-x-hidden flex-1 -mt-2 relative z-[5]">
        <!-- Top gradient fade -->
        <div
          class="pointer-events-none sticky top-0 left-0 right-0 h-3 -mb-1 bg-linear-to-b from-sidebar to-transparent z-10"
        ></div>
        <NotesPanel {notes} {workspaceId} {selectedNoteId} {onOpenNote} {onReorderNotes} />
        <!-- Bottom gradient fade -->
        <div
          class="pointer-events-none sticky -bottom-px left-0 right-0 h-3 bg-linear-to-t from-sidebar to-transparent z-10"
        ></div>
      </div>
    </ResizablePanel>

    <!-- Browser Section (collapsible) -->
    <!-- {#if onOpenUrl}
      <div class="w-full shrink-0 group/browser">
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-2 cursor-pointer"
          onclick={() => (browserCollapsed = !browserCollapsed)}
        >
          <span class="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            Browser
          </span>
          <Fa
            icon={faChevronDown}
            size="9"
            class="text-muted-foreground/50 transition-transform duration-200 {browserCollapsed
              ? 'rotate-90'
              : ''}"
          />
        </button>
        {#if !browserCollapsed}
          <div class="w-full" transition:slide={{ axis: 'y', duration: 200 }}>
            <BrowserPanel {workspaceId} {onOpenUrl} class="pb-2" />
          </div>
        {/if}
      </div>
    {/if} -->

    <!-- Files / Code Changes Toggle -->
    <div class="w-full flex-1 flex flex-col min-h-32">
      <SidebarToggle
        tabs={[
          { id: 'changes', label: 'Changes' },
          { id: 'files', label: 'All Files' },
        ]}
        bind:activeTab={codeTab}
        contentClass="mb-6"
      >
        {#snippet headerRight()}
          {#if codeTab === 'files'}
            <div class="h-0 flex items-center gap-2">
              <Button
                variant="ghost-light"
                size="icon-xs"
                class="p-0.5 rounded transition-colors cursor-pointer {showOnlyChangedFiles
                  ? 'text-primary'
                  : 'text-muted-foreground/50 hover:text-muted-foreground'}"
                tooltip={showOnlyChangedFiles ? 'Show all files' : 'Show only changed files'}
                onclick={() => (showOnlyChangedFiles = !showOnlyChangedFiles)}
                title={showOnlyChangedFiles ? 'Show all files' : 'Show only changed files'}
              >
                <Fa icon={faPenAlt} size="xs" />
              </Button>
              <button
                type="button"
                class="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
                onclick={() => paletteStore.open()}
                >Search <span class="font-mono tracking-wider font-medium">⌘P</span></button
              >
            </div>
          {:else if codeTab === 'changes' && hasChanges}
            <div class="shrink-0 -my-2">
              <ToggleGroup.Root bind:value={viewMode} size="xs" variant="default" class="">
                <ToggleGroup.Item value="list" size="xs" tooltip="List view">
                  <Fa icon={faList} size="xs" />
                </ToggleGroup.Item>
                <ToggleGroup.Item value="tree" size="xs" tooltip="Tree view">
                  <Fa icon={faFolderTree} size="xs" />
                </ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
          {/if}
        {/snippet}
        {#snippet beforeScroll(tabId)}
          {#if tabId === 'changes'}
            <div class="px-3 pb-2 mt-2">
              <Button
                variant="ghost-light"
                size="sm"
                class="w-full bg-backgroundx flex-col h-auto! py-2 items-start text-muted-foreground/80 border border-muted-foreground/20 {isAcceptChangesOpen
                  ? 'bg-background'
                  : ''}"
                onclick={() => onAcceptChanges?.()}
              >
                <div class="w-full text-xs text-left flex items-center">
                  {#if totalChanges > 0}
                    Review {totalChanges} change{totalChanges === 1 ? '' : 's'}
                  {:else}
                    View changes
                  {/if}
                  <Fa icon={faArrowRight} size="xs" class=" ml-auto opacity-50" />
                </div>
                <!-- File Icons -->
                {#if totalChanges > 0}
                  <div class="w-full flex">
                    <div class="flex -ml-0.5">
                      {#each allChanges.slice(0, 6) as change (change.id)}
                        {@const changeType = getChangeType(change)}
                        {@const fileName =
                          change.relativePath.split('/').pop() || change.relativePath}
                        {@const colorClass =
                          changeType === 'added'
                            ? 'text-emerald-500'
                            : changeType === 'deleted'
                              ? 'text-red-500'
                              : 'text-muted-foreground/50'}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span
                          class="px-0.5 transition-transform duration-150 hover:scale-110 {colorClass}"
                          style="anchor-name: --change-{change.id}"
                          onmouseenter={() => (hoveredChangeId = change.id)}
                          onmouseleave={() => (hoveredChangeId = null)}
                          title={fileName}
                        >
                          <Fa icon={faFile} size="xs" />
                        </span>
                      {/each}
                      {#if totalChanges > 6}
                        <span class="text-[10px] text-muted-foreground/50 self-center pl-0.5"
                          >+{totalChanges - 6}</span
                        >
                      {/if}
                    </div>
                    <!-- <span class="ml-auto text-xs">{hasChanges ? 'Review' : 'View'}</span> -->
                  </div>
                {/if}
              </Button>
            </div>
          {/if}
        {/snippet}
        {#snippet content(tabId)}
          {#if tabId === 'files'}
            <FilesPanel
              {workspacePath}
              {workspaceId}
              {selectedFile}
              {onOpenFile}
              showOnlyChanged={showOnlyChangedFiles}
            />
          {:else if tabId === 'changes'}
            {#if hasCodeSection || isChangesLoading}
              <CodeChangesPanel
                {unstagedChanges}
                {stagedChanges}
                {selectedChangeId}
                {onOpenChange}
                {onStageChange}
                {onUnstageChange}
                {onRevertChange}
                {onAcceptChanges}
                {commits}
                {unpushedCount}
                {pullRequests}
                {onOpenCommit}
                {onOpenPR}
                {viewMode}
                isLoading={isChangesLoading}
              />
            {:else}
              <!-- <div class="px-4 py-3 text-sm text-muted-foreground">No code changes</div> -->
            {/if}
          {/if}
        {/snippet}
      </SidebarToggle>
    </div>

    <!-- Activity Log Preview -->
    <ActivityLogPreview
      events={recentActivity}
      onOpenEvent={onOpenActivityEvent}
      onViewAll={onViewAllActivity}
    />
  {/if}
</div>

<!-- Hover Card for file change icons -->
{#if hoveredChangeId}
  {@const hoveredChange = allChanges.find((c) => c.id === hoveredChangeId)}
  {#if hoveredChange}
    {@const fileName = hoveredChange.relativePath.split('/').pop() || hoveredChange.relativePath}
    {@const dirPath = hoveredChange.relativePath.includes('/')
      ? hoveredChange.relativePath.substring(0, hoveredChange.relativePath.lastIndexOf('/'))
      : ''}
    <HoverCard anchor="--change-{hoveredChangeId}" position="bottom-left">
      <div class="p-2 flex flex-col gap-1 max-w-64">
        <div class="text-sm font-medium text-foreground leading-tight truncate">
          {fileName}
        </div>
        {#if dirPath}
          <div class="text-xs text-muted-foreground truncate">
            {dirPath}
          </div>
        {/if}
        <div class="flex items-center gap-2 text-xs">
          {#if hoveredChange.stats.additions > 0}
            <span class="text-emerald-500">+{hoveredChange.stats.additions}</span>
          {/if}
          {#if hoveredChange.stats.deletions > 0}
            <span class="text-red-500">-{hoveredChange.stats.deletions}</span>
          {/if}
        </div>
      </div>
    </HoverCard>
  {/if}
{/if}
