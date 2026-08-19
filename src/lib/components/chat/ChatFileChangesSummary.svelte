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
  import { formatInteger } from '$lib/i18n/format';
  import type { AgentMessage } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
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
  import {
    CHAT_OPERATIONAL_CONTAINER_CLASS,
    CHAT_OPERATIONAL_ICON_CLASS,
    CHAT_OPERATIONAL_LEADING_CLASS,
    CHAT_OPERATIONAL_ROW_CLASS,
    CHAT_OPERATIONAL_SUMMARY_CLASS,
    CHAT_OPERATIONAL_TRAILING_CLASS,
  } from './operational-disclosure-row';

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

  let displayLabel = $derived.by(() => {
    const count = formatInteger(summary.totalFiles);
    const filesChanged =
      summary.totalFiles === 1
        ? m.chat_changesPanel_filesChanged_one({ count })
        : m.chat_changesPanel_filesChanged_many({ count });
    return `${filesChanged}${suffix ? ` ${suffix}` : ''}`;
  });

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
  <div
    class="{CHAT_OPERATIONAL_CONTAINER_CLASS} mt-4 {isAggregate ? 'mb-1' : ''}"
    data-chat-operational-row
    data-testid="file-changes-surface"
  >
    <button
      type="button"
      onclick={handleClick}
      aria-disabled={readOnly}
      tabindex={readOnly ? -1 : undefined}
      class="{CHAT_OPERATIONAL_ROW_CLASS} group cursor-pointer text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-operational-disclosure-row
      data-compact-tool-row
    >
      <span class={CHAT_OPERATIONAL_LEADING_CLASS} data-operational-leading>
        <Fa icon={faFile} class={CHAT_OPERATIONAL_ICON_CLASS} />
      </span>
      <span class={CHAT_OPERATIONAL_SUMMARY_CLASS} data-operational-summary>
        {displayLabel}
      </span>

      <span class={CHAT_OPERATIONAL_TRAILING_CLASS} data-operational-trailing>
        <Fa
          icon={faArrowRight}
          class="h-3.5! w-3.5! shrink-0 opacity-30 transition-opacity group-hover:opacity-50"
        />
      </span>
    </button>
  </div>
{/if}
