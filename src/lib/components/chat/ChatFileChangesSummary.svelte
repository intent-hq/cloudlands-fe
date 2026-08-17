<script lang="ts">
  /**
   * Chat File Changes Summary
   *
   * Displays a summary of file changes made during the chat conversation.
   * Clicking opens the changes in the main panel.
   */

  import Fa from 'svelte-fa';
  import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
  import { faFile } from '@fortawesome/free-regular-svg-icons';
  import type { AgentMessage } from '$shared/types';
  import {
    getFileChangesFromMessages,
    getFileChangesFromMessage,
    getFileChangesFromMessageMemoKey,
    type ChatFileChangeSummary,
  } from '$lib/utils/get-file-changes-from-messages';

  import {
    openWorkspaceChatChanges,
    type JsonValue,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    /** Workspace that owns this conversation */
    workspaceId: string;
    /** Single message to show changes for (per-turn mode) */
    message?: AgentMessage;
    /** All messages to show aggregate changes (aggregate mode) */
    messages?: AgentMessage[];
    /** Label to show (defaults to "X files changed") */
    suffix?: string;
    /** Whether this is showing aggregate changes */
    isAggregate?: boolean;
    /** Whether the message is currently streaming */
    isStreaming?: boolean;
    /** Agent ID for linking back to the agent */
    agentId?: string;
    /** Turn number within the conversation */
    turnNumber?: number;
    /** Keep the production row inert in deterministic catalog previews. */
    readOnly?: boolean;
  }

  let {
    workspaceId,
    message,
    messages,
    suffix,
    isAggregate = false,
    isStreaming = false,
    agentId,
    turnNumber,
    readOnly = false,
  }: Props = $props();

  function createMessageSummaryMemo() {
    let lastKey: string | undefined;
    let lastWasStreaming = false;
    let lastSummary: ChatFileChangeSummary = {
      changes: [],
      totalFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
    };

    return (nextMessage: AgentMessage, nextIsStreaming: boolean) => {
      const nextKey = getFileChangesFromMessageMemoKey(nextMessage);
      if (nextKey !== lastKey || (lastWasStreaming && !nextIsStreaming)) {
        lastKey = nextKey;
        lastSummary = getFileChangesFromMessage(nextMessage);
      }
      lastWasStreaming = nextIsStreaming;
      return lastSummary;
    };
  }

  const getMemoizedMessageSummary = createMessageSummaryMemo();

  // Compute file changes
  let summary: ChatFileChangeSummary = $derived.by(() => {
    if (message) {
      return getMemoizedMessageSummary(message, isStreaming);
    } else if (messages) {
      return getFileChangesFromMessages(messages);
    }
    return { changes: [], totalFiles: 0, totalAdditions: 0, totalDeletions: 0 };
  });

  // Only show if there are changes
  let hasChanges = $derived(summary.totalFiles > 0);

  let displayLabel = $derived(
    `${summary.totalFiles} file${summary.totalFiles !== 1 ? 's' : ''} changed${suffix ? ` ${suffix}` : ''}`,
  );

  function handleClick(event: MouseEvent) {
    if (readOnly) return;
    // Navigate to chat changes view
    // Pass message reference for reactive updates during streaming
    const sourcePanelId = (event.currentTarget as HTMLElement)
      .closest<HTMLElement>('[data-panel-id]')
      ?.getAttribute('data-panel-id');
    appStore.dispatch(
      openWorkspaceChatChanges(
        workspaceId,
        summary.changes as unknown as JsonValue[],
        displayLabel,
        {
          messageId: message?.id,
          isAggregate,
          agentId,
          turnNumber,
          ...(sourcePanelId ? { sourcePanelId } : {}),
        },
      ),
    );
  }
</script>

{#if hasChanges}
  <div class="mt-4 w-full {isAggregate ? 'mb-1' : ''}" data-testid="file-changes-surface">
    <button
      onclick={handleClick}
      aria-disabled={readOnly}
      tabindex={readOnly ? -1 : undefined}
      class="type-caption group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-muted-foreground transition-colors duration-[var(--motion-fast)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <Fa
          icon={faFile}
          class="h-4! w-4! shrink-0 opacity-40 transition-opacity group-hover:opacity-60"
        />
        <span class="truncate min-w-0 text-left flex-1">
          {displayLabel}
        </span>

        <!-- <LineChangesBadge
          additions={summary.totalAdditions}
          deletions={summary.totalDeletions}
          size="xs"
        /> -->
      </div>

      <Fa
        icon={faArrowRight}
        class="h-3.5! w-3.5! shrink-0 opacity-30 transition-opacity group-hover:opacity-50"
      />
    </button>
  </div>
{/if}
