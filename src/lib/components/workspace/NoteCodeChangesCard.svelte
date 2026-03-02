<script lang="ts">
  /**
   * NoteCodeChangesCard - A sleek, compact card showing code changes from agents
   *
   * Displays file changes made by assigned agents in a clean, Vercel-like UI.
   * Shows inline below the metadata bar with expandable file list.
   */

  import Fa from 'svelte-fa';
  import { faChevronDown, faChevronRight, faCode } from '@fortawesome/free-solid-svg-icons';
  import { faFile } from '@fortawesome/free-regular-svg-icons';
  import type { Note, AgentMessage } from '$shared/types';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { createLogger } from '$lib/utils/client-logger';
  import { agentService } from '$features/agent/agent.service';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
  import {
    getFileChangesFromMessages,
    type ChatFileChange,
  } from '$lib/utils/get-file-changes-from-messages';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { slide } from 'svelte/transition';
  import { untrack } from 'svelte';

  const logger = createLogger('NoteCodeChangesCard');

  interface Props {
    workspaceId: WorkspaceId;
    note: Note;
  }

  let { workspaceId: _workspaceId, note }: Props = $props();

  // State
  let isExpanded = $state(false);
  let isLoading = $state(false);
  let changes = $state<ChatFileChange[]>([]);

  // Get assigned agent IDs from note metadata
  const assignedAgentIds = $derived(note.metadata?.task?.assignedAgentIds || []);
  const hasAgents = $derived(assignedAgentIds.length > 0);

  // Computed stats
  const totalFiles = $derived(changes.length);
  const totalAdditions = $derived(changes.reduce((sum, c) => sum + c.additions, 0));
  const totalDeletions = $derived(changes.reduce((sum, c) => sum + c.deletions, 0));
  const hasChanges = $derived(totalFiles > 0);

  // Display config
  const MAX_VISIBLE_FILES = 5;
  const displayedChanges = $derived(isExpanded ? changes : changes.slice(0, MAX_VISIBLE_FILES));
  const hasMoreFiles = $derived(changes.length > MAX_VISIBLE_FILES);

  // Load changes from agents
  async function loadChanges() {
    if (!hasAgents) {
      changes = [];
      return;
    }

    isLoading = true;
    try {
      const allMessages: AgentMessage[] = [];
      const workspace = workspaceStore.current;

      for (const agentId of assignedAgentIds) {
        try {
          let agent = agentService.getSession(agentId);
          if (!agent && workspace) {
            agent = await agentService.restoreSession(agentId, workspace);
          }
          if (agent?.messages) {
            allMessages.push(...agent.messages);
          }
        } catch (error) {
          logger.error('Error loading agent messages', { agentId, error });
        }
      }

      const summary = getFileChangesFromMessages(allMessages);
      changes = summary.changes;
    } catch (error) {
      logger.error('Error loading changes', error);
      changes = [];
    } finally {
      isLoading = false;
    }
  }

  // Load changes when agents change
  // Track previous agent IDs to detect changes
  let prevAgentIds: string[] = [];

  $effect(() => {
    // Read the reactive dependency
    const currentAgentIds = assignedAgentIds;
    const agentIdsChanged =
      currentAgentIds.length !== prevAgentIds.length ||
      currentAgentIds.some((id, i) => id !== prevAgentIds[i]);

    if (agentIdsChanged) {
      prevAgentIds = [...currentAgentIds];

      // Perform async work outside of reactive tracking
      untrack(() => {
        if (currentAgentIds.length > 0) {
          loadChanges();
        } else {
          changes = [];
        }
      });
    }
  });

  function getFileName(path: string): string {
    return path.split('/').pop() || path;
  }

  function getDirectory(path: string): string {
    const parts = path.split('/');
    parts.pop();
    const dir = parts.join('/');
    return dir;
  }

  /**
   * Find the current tracked change for a file path from the store.
   * Only returns staged/unstaged changes - NOT committed changes.
   * We want to show the current working tree state, not historical commits.
   */
  function findTrackedChange(filePath: string): TrackedChange | null {
    // Only look for active (staged or unstaged) changes
    // Do NOT fall back to committed changes - those would show historical diffs
    // instead of the current working tree state
    return (
      fileTrackingStore.changes.find(
        (c) =>
          (c.relativePath === filePath || c.file === filePath) &&
          (c.stage === 'staged' || c.stage === 'unstaged'),
      ) ?? null
    );
  }

  function handleFileClick(change: ChatFileChange) {
    // Look up the actual tracked change from the store to get the correct stage
    const trackedChange = findTrackedChange(change.filePath);

    // Use the tracked change if found, otherwise create a fallback
    // The fallback doesn't specify a stage - let the diff viewer try both
    const changeData: TrackedChange = trackedChange || {
      id: `chat-change-${change.filePath}`,
      file: change.filePath,
      relativePath: change.filePath,
      status: 'modified' as const,
      stage: ChangeStage.Unstaged,
      stats: { additions: change.additions, deletions: change.deletions },
      attribution: {
        manual: true,
        timestamp: Date.now(),
      },
      // Include the original content from agent messages if available
      content:
        change.oldContent || change.newContent
          ? {
              oldContent: change.oldContent,
              newContent: change.newContent,
            }
          : undefined,
    };

    const detail = {
      change: changeData,
      filePath: change.filePath,
      changeId: trackedChange?.id || `chat-change-${change.filePath}`,
    };
    window.dispatchEvent(new CustomEvent('workspace:open-diff', { detail }));
  }

  function handleViewAllClick() {
    window.dispatchEvent(
      new CustomEvent('workspace:open-chat-changes', {
        detail: {
          changes,
          title: `Changes from: ${note.title || 'Task'}`,
          isAggregate: true,
        },
      }),
    );
  }
</script>

{#if hasAgents && (hasChanges || isLoading)}
  <div class="w-full flex justify-center">
    <div
      class="w-full max-w-[var(--content-max-width,60rem)] px-14 pb-4"
      transition:slide={{ duration: 150 }}
    >
      <div class="rounded-lg border border-border overflow-hidden">
        <!-- Header -->
        <button
          onclick={() => (isExpanded = !isExpanded)}
          class="w-full flex items-center justify-between px-4 py-2.5 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-2.5">
            <!-- <div class="flex items-center justify-center w-5 h-5 rounded bg-muted/50">
              <Fa icon={faCode} class="text-ghost" size="xs" />
            </div> -->
            <span class="text-sm font-medium text-foreground/90">
              {#if isLoading}
                Loading changes...
              {:else}
                {totalFiles} file{totalFiles !== 1 ? 's' : ''} changed
              {/if}
            </span>
            {#if !isLoading && hasChanges}
              <LineChangesBadge additions={totalAdditions} deletions={totalDeletions} size="xs" />
            {/if}
          </div>
          <Fa
            icon={isExpanded ? faChevronDown : faChevronRight}
            class="text-subtle"
            size="xs"
          />
        </button>

        <!-- File List -->
        {#if isExpanded && hasChanges}
          <div class="border-t border-border/30" transition:slide={{ duration: 150 }}>
            <div class="divide-y divide-border/20">
              {#each displayedChanges as change (change.filePath)}
                <button
                  onclick={() => handleFileClick(change)}
                  class="w-full flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer text-left group"
                >
                  <Fa icon={faFile} class="text-ghost shrink-0" size="xs" />
                  <div class="flex-1 min-w-0 flex items-baseline gap-2">
                    <span class="text-sm truncate text-foreground">
                      {getFileName(change.filePath)}
                    </span>
                    {#if getDirectory(change.filePath)}
                      <span
                        class="flex-1 text-xs text-subtle truncate hidden sm:inline"
                      >
                        {getDirectory(change.filePath)}
                      </span>
                    {/if}
                  </div>
                  <LineChangesBadge
                    additions={change.additions}
                    deletions={change.deletions}
                    size="xs"
                  />
                </button>
              {/each}
            </div>

            <!-- Footer -->
            {#if hasMoreFiles && !isExpanded}
              <div class="px-4 py-2 border-t border-border/30">
                <span class="text-xs text-subtle">
                  +{changes.length - MAX_VISIBLE_FILES} more files
                </span>
              </div>
            {/if}

            <!-- View All Link -->
            <div class="px-4 pt-0.5 pb-1 bg-muted/30">
              <button
                onclick={handleViewAllClick}
                class="text-xs text-subtle transition-colors cursor-pointer"
              >
                View all changes →
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
