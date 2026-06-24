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

  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    openWorkspaceChatChanges,
    type JsonValue,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
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
  }

  let {
    message,
    messages,
    suffix,
    isAggregate = false,
    isStreaming = false,
    agentId,
    turnNumber,
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

  function handleClick() {
    // Navigate to chat changes view
    // Pass message reference for reactive updates during streaming
    const wsId = selectActiveWorkspaceId.select(appStore.state);
    if (!wsId) return;
    appStore.dispatch(
      openWorkspaceChatChanges(wsId, summary.changes as unknown as JsonValue[], displayLabel, {
        messageId: message?.id,
        isAggregate,
        agentId,
        turnNumber,
      }),
    );
  }
</script>

{#if hasChanges}
  <div class="w-full {isAggregate ? 'mb-1' : ''}">
    <button
      onclick={handleClick}
      class="w-full flex items-center gap-2 px-2 py-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors group cursor-pointer min-w-0"
    >
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <Fa icon={faFile} class="opacity-30" size="xs" />
        <span class="truncate min-w-0 text-left flex-1">
          {displayLabel}
        </span>

        <!-- <LineChangesBadge
          additions={summary.totalAdditions}
          deletions={summary.totalDeletions}
          size="xs"
        /> -->
      </div>

      <Fa icon={faArrowRight} class="opacity-30 w-3 h-3 shrink-0 transition-colors" />
    </button>
  </div>
{/if}
