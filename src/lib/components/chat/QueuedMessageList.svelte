<script lang="ts">
  /**
   * QueuedMessageList Component
   *
   * Displays queued messages at the bottom of the chat panel.
   * Messages are shown in a muted style with edit and delete functionality.
   */

  import Fa from 'svelte-fa';
  import {
  faPen,
  faTrash,
  faCheck,
  faTimes,
  faListOl,
  faPaperPlane,
  faRotateRight,
  faBell,
} from '@fortawesome/free-solid-svg-icons';
  import {
  fly,
  slide,
} from 'svelte/transition';
  import type { QueuedMessage } from '$shared/types';
  import Button from '../ui/button/button.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import { parseAgentEvents } from './EventWakeupBanner.svelte';

  interface Props {
    messages: QueuedMessage[];
    disabled?: boolean;
    onedit?: (messageId: string, content: string, editing?: boolean) => Promise<{ success: boolean; error?: string }>;
    onremove?: (messageId: string) => void;
    onsendnow?: (messageId: string) => void;
    ondone?: () => void;
  }

  let { messages = [], disabled = false, onedit, onremove, onsendnow, ondone }: Props = $props();

  // Track which message is being edited
  let editingId = $state<string | null>(null);
  let editContent = $state('');
  let editOriginalContent = $state('');
  let editStartedProgrammatically = $state(false);

  // Auto-resize textarea to fit content
  function autoResize(node: HTMLTextAreaElement) {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = node.scrollHeight + 'px';
    };
    resize();
    node.addEventListener('input', resize);
    return {
      destroy() {
        node.removeEventListener('input', resize);
      },
    };
  }

  // Action to autofocus textarea when it appears
  function autofocusAction(node: HTMLTextAreaElement) {
    // Use requestAnimationFrame to ensure the element is fully rendered
    requestAnimationFrame(() => {
      node.focus({ preventScroll: true });
      // Move cursor to end
      node.selectionStart = node.selectionEnd = node.value.length;
    });
  }

  async function startEdit(message: QueuedMessage) {
    editStartedProgrammatically = false;
    editingId = message.id;
    editContent = message.content;
    editOriginalContent = message.content;

    // STAB-27: Engage hold immediately (editing:true) so the message isn't
    // dequeued mid-edit. If the message is already gone (race with drain),
    // the backend will error and we'll handle gracefully.
    if (onedit) {
      try {
        const result = await onedit(message.id, message.content, true);
        if (!result.success) {
          // Message was already dequeued - clear edit state
          // TODO STAB-27: Drop content into composer as draft instead of losing it
          console.warn('Failed to hold queued message for editing:', result.error);
          editingId = null;
          editContent = '';
          editOriginalContent = '';
        }
      } catch (error) {
        // IPC/network failure - clear edit state
        console.error('Exception while engaging hold for queued message edit:', error);
        editingId = null;
        editContent = '';
        editOriginalContent = '';
      }
    }
  }

  async function cancelEdit() {
    const wasProgrammatic = editStartedProgrammatically;
    const messageId = editingId;
    const originalContent = editOriginalContent;

    // STAB-27: Release hold with original content (editing:false) BEFORE clearing edit state
    // so if the release fails, we stay in edit mode and the user can retry
    if (messageId && onedit) {
      try {
        const result = await onedit(messageId, originalContent, false);
        if (!result.success) {
          // Release failed - stay in edit mode
          console.error('Failed to release queued message hold on cancel:', result.error);
          return;
        }
      } catch (error) {
        // IPC/network failure - stay in edit mode
        console.error('Exception while releasing queued message hold on cancel:', error);
        return;
      }
    }

    // Only clear edit state after successful release
    editingId = null;
    editContent = '';
    editOriginalContent = '';
    editStartedProgrammatically = false;

    if (wasProgrammatic) ondone?.();
  }

  async function saveEdit() {
    if (editingId && editContent.trim()) {
      const wasProgrammatic = editStartedProgrammatically;
      const messageId = editingId;
      const newContent = editContent.trim();

      // STAB-27: Save with edited content and release hold (editing:false triggers self-drain)
      // Do this BEFORE clearing edit state so if it fails, we stay in edit mode
      if (onedit) {
        try {
          const result = await onedit(messageId, newContent, false);
          if (!result.success) {
            // Save failed - stay in edit mode
            console.error('Failed to save queued message edit:', result.error);
            return;
          }
        } catch (error) {
          // IPC/network failure - stay in edit mode
          console.error('Exception while saving queued message edit:', error);
          return;
        }
      }

      // Only clear edit state after successful save
      editingId = null;
      editContent = '';
      editOriginalContent = '';
      editStartedProgrammatically = false;

      if (wasProgrammatic) ondone?.();
    } else if (editingId) {
      await cancelEdit();
    }
  }

  function handleRemove(id: string) {
    onremove?.(id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }

  /**
   * Whether a queued message is a system-generated event notification wake.
   * Metadata-first (`messageMetadata.type === 'event_notification'`), with the
   * `[WORKSPACE EVENTS]` content prefix as fallback for daemons that don't
   * send queue metadata yet.
   */
  function isEventNotification(message: QueuedMessage): boolean {
    if (message.messageMetadata?.type === 'event_notification') return true;
    return message.content.startsWith('[WORKSPACE EVENTS]');
  }

  /**
   * Parse agent events resiliently: messageMetadata is opaque, so an
   * unexpected shape (no events array, or malformed event items) falls back
   * to parseAgentEvents' legacy text parsing instead of erroring.
   */
  function safeParseAgentEvents(message: QueuedMessage): ReturnType<typeof parseAgentEvents> {
    const metadata = Array.isArray(message.messageMetadata?.events)
      ? (message.messageMetadata as Parameters<typeof parseAgentEvents>[1])
      : undefined;
    try {
      return parseAgentEvents(message.content, metadata);
    } catch {
      try {
        return metadata ? parseAgentEvents(message.content) : [];
      } catch {
        return [];
      }
    }
  }

  /** Short human label + muted report preview for an event-notification wake. */
  function eventWakeSummary(message: QueuedMessage): { label: string; preview?: string } {
    const events = safeParseAgentEvents(message);
    const idle = events.filter((e) => e.type === 'agent:idle');
    const created = events.filter((e) => e.type === 'agent:created');
    const parts: string[] = [];
    if (idle.length === 1) {
      parts.push(`Child agent ${idle[0].agentName ?? idle[0].agentId} completed`);
    } else if (idle.length > 1) {
      parts.push(`${idle.length} child agents completed`);
    }
    if (created.length === 1) {
      parts.push(`Child agent ${created[0].agentName ?? created[0].agentId} created`);
    } else if (created.length > 1) {
      parts.push(`${created.length} child agents created`);
    }
    const label = parts.length > 0 ? parts.join(' · ') : 'Workspace events';
    const withReport = idle.find((e) => e.completionReport || e.lastResponseSummary);
    return { label, preview: withReport?.completionReport ?? withReport?.lastResponseSummary };
  }

  /**
   * Sender attribution for a queued agent-to-agent message
   * (`messageMetadata.type === 'agent_message'`). Returns null when the
   * metadata is absent or malformed so the entry renders as a normal
   * queued message.
   */
  function queuedAgentAttribution(message: QueuedMessage) {
    return getAgentMessageAttribution(message.messageMetadata);
  }

  /**
   * Exposed function for parent components to programmatically start editing
   * the last queued message (e.g., when user presses Up arrow in chat input).
   * Skips system event-notification wakes and agent-to-agent messages
   * (not user-editable).
   * Returns true if editing was started, false if no messages to edit.
   */
  export function editLastMessage(): boolean {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isEventNotification(messages[i]) || queuedAgentAttribution(messages[i])) continue;
      startEdit(messages[i]);
      editStartedProgrammatically = true;
      return true;
    }
    return false;
  }
</script>

{#if messages.length > 0}
  <div class="relative border-t border-border/50 pt-3 pb-2 px-2 z-20" transition:slide={{ duration: 200 }}>
    <div class="flex items-center gap-1.5 text-xs text-subtle mb-2 px-2.5">
        <Fa icon={faListOl} class="w-3 h-3" />
        <span>Queued messages ({messages.length})</span>
      </div>

      <div class="space-y-px">
        {#each messages as message (message.id)}
          <div
            class="group flex items-start gap-2 px-2.5 py-1 text-subtle text-sm grid {message.editing ? 'opacity-60' : ''}"
            transition:fly={{ y: 10, duration: 200 }}
            title={message.editing ? 'Held for editing' : undefined}
          >
            {#if editingId === message.id}
              <!-- Edit mode -->
              <div
                class="col-span-full row-span-full flex-1 flex gap-2 flex"
                transition:slide={{ axis: 'y', duration: 200 }}
              >
                <textarea
                  bind:value={editContent}
                  onkeydown={handleKeydown}
                  use:autofocusAction
                  use:autoResize
                  onblur={saveEdit}
                  rows="1"
                  class="flex-1 rounded py-0! text-sm text-foreground resize-none focus:outline-none! focus:ring-0! overflow-hidden"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck="false"
                ></textarea>
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="-my-1"
                  onclick={saveEdit}
                  tooltip="Save"
                >
                  <Fa icon={faCheck} class="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="-my-1"
                  onclick={cancelEdit}
                  tooltip="Cancel"
                >
                  <Fa icon={faTimes} class="w-3 h-3" />
                </Button>
              </div>
            {:else if isEventNotification(message)}
              <!-- System event-notification wake: compact row, no edit -->
              {@const wake = eventWakeSummary(message)}
              <div class="col-span-full row-span-full flex flex-1 min-w-0 items-center gap-2">
                {#if message.requeuedAfterFailure}
                  <div
                    class="flex items-center gap-1 text-warning text-xs shrink-0"
                    title="Failed — will retry"
                  >
                    <div aria-hidden="true">
                      <Fa icon={faRotateRight} class="w-3 h-3" />
                    </div>
                    <span class="sr-only">Failed — will retry</span>
                  </div>
                {/if}
                <div aria-hidden="true" class="shrink-0">
                  <Fa icon={faBell} class="w-3 h-3" />
                </div>
                <div
                  class="flex-1 min-w-0 truncate"
                  transition:slide={{ axis: 'y', duration: 200 }}
                  title={message.content}
                >
                  <span>{wake.label}</span>
                  {#if wake.preview}
                    <span class="text-xs opacity-70"> — {wake.preview}</span>
                  {/if}
                </div>
                {#if !disabled}
                  <div
                    class="flex items-center gap-1 opacity-30 group-hover:opacity-100 transition-opacity"
                  >
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="-my-1"
                      onclick={() => onsendnow?.(message.id)}
                      tooltip="Send now (interrupts current stream)"
                    >
                      <Fa icon={faPaperPlane} class="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="-my-1"
                      onclick={() => handleRemove(message.id)}
                      tooltip="Remove"
                    >
                      <Fa icon={faTrash} class="w-3 h-3" />
                    </Button>
                  </div>
                {/if}
              </div>
            {:else if queuedAgentAttribution(message)}
              <!-- Agent-to-agent message: compact attribution row, no edit -->
              {@const attr = queuedAgentAttribution(message)}
              {#if attr}
                <div class="col-span-full row-span-full flex flex-1 min-w-0 items-center gap-2">
                  {#if message.requeuedAfterFailure}
                    <div
                      class="flex items-center gap-1 text-warning text-xs shrink-0"
                      title="Failed — will retry"
                    >
                      <div aria-hidden="true">
                        <Fa icon={faRotateRight} class="w-3 h-3" />
                      </div>
                      <span class="sr-only">Failed — will retry</span>
                    </div>
                  {/if}
                  <div class="shrink-0" data-testid="queued-agent-message-avatar">
                    <AuggieAvatar agentId={attr.fromAgentId} size={14} />
                  </div>
                  <div
                    class="flex-1 min-w-0 truncate"
                    transition:slide={{ axis: 'y', duration: 200 }}
                    title={message.content}
                  >
                    <span class="text-foreground font-medium">{attr.displayName}</span>
                    <span class="text-xs opacity-70"> — {message.content}</span>
                  </div>
                  {#if !disabled}
                    <div
                      class="flex items-center gap-1 opacity-30 group-hover:opacity-100 transition-opacity"
                    >
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="-my-1"
                        onclick={() => onsendnow?.(message.id)}
                        tooltip="Send now (interrupts current stream)"
                      >
                        <Fa icon={faPaperPlane} class="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="-my-1"
                        onclick={() => handleRemove(message.id)}
                        tooltip="Remove"
                      >
                        <Fa icon={faTrash} class="w-3 h-3" />
                      </Button>
                    </div>
                  {/if}
                </div>
              {/if}
            {:else}
              <!-- Display mode -->
              <div class="col-span-full row-span-full flex flex-1 min-w-0 gap-2">
                {#if message.requeuedAfterFailure}
                  <div
                    class="flex items-center gap-1 text-warning text-xs shrink-0"
                    title="Failed — will retry"
                  >
                    <div aria-hidden="true">
                      <Fa icon={faRotateRight} class="w-3 h-3" />
                    </div>
                    <span class="sr-only">Failed — will retry</span>
                  </div>
                {/if}
                <button
                  class="flex-1 text-left truncate cursor-pointer"
                  transition:slide={{ axis: 'y', duration: 200 }}
                  onclick={() => startEdit(message)}
                >
                  {message.requeuedAfterFailure ? '(Failed — will retry) ' : ''}{message.content}
                </button>
                {#if !disabled}
                  <div
                    class="flex items-center gap-1 opacity-30 group-hover:opacity-100 transition-opacity"
                  >
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="-my-1"
                      onclick={() => onsendnow?.(message.id)}
                      tooltip="Send now (interrupts current stream)"
                    >
                      <Fa icon={faPaperPlane} class="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="-my-1"
                      onclick={() => startEdit(message)}
                      tooltip="Edit"
                    >
                      <Fa icon={faPen} class="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="-my-1"
                      onclick={() => handleRemove(message.id)}
                      tooltip="Remove"
                    >
                      <Fa icon={faTrash} class="w-3 h-3" />
                    </Button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
  </div>
{/if}
