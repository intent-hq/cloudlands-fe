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
  } from '@fortawesome/free-solid-svg-icons';
  import { fly, slide } from 'svelte/transition';
  import type { QueuedMessage } from '$shared/types';
  import Button from '../ui/button/button.svelte';

  interface Props {
    messages: QueuedMessage[];
    disabled?: boolean;
    onedit?: (messageId: string, content: string) => void;
    onremove?: (messageId: string) => void;
    onsendnow?: (messageId: string) => void;
    ondone?: () => void;
  }

  let { messages = [], disabled = false, onedit, onremove, onsendnow, ondone }: Props = $props();

  // Track which message is being edited
  let editingId = $state<string | null>(null);
  let editContent = $state('');
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

  function startEdit(message: QueuedMessage) {
    editStartedProgrammatically = false;
    editingId = message.id;
    editContent = message.content;
  }

  function cancelEdit() {
    const wasProgrammatic = editStartedProgrammatically;
    editingId = null;
    editContent = '';
    editStartedProgrammatically = false;
    if (wasProgrammatic) ondone?.();
  }

  function saveEdit() {
    if (editingId && editContent.trim()) {
      const wasProgrammatic = editStartedProgrammatically;
      onedit?.(editingId, editContent.trim());
      editingId = null;
      editContent = '';
      editStartedProgrammatically = false;
      if (wasProgrammatic) ondone?.();
    } else if (editingId) {
      cancelEdit();
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
   * Exposed function for parent components to programmatically start editing
   * the last queued message (e.g., when user presses Up arrow in chat input).
   * Returns true if editing was started, false if no messages to edit.
   */
  export function editLastMessage(): boolean {
    if (messages.length === 0) return false;
    const lastMessage = messages[messages.length - 1];
    startEdit(lastMessage);
    editStartedProgrammatically = true;
    return true;
  }
</script>

{#if messages.length > 0}
  <div class="relative border-t border-border/50 pt-3 pb-2 px-2 z-20" transition:slide={{ duration: 200 }}>
    <div class="flex items-center gap-1.5 text-xs text-muted-foreground/60 mb-2 px-2.5">
        <Fa icon={faListOl} class="w-3 h-3" />
        <span>Queued messages ({messages.length})</span>
      </div>

      <div class="space-y-px">
        {#each messages as message (message.id)}
          <div
            class="group flex items-start gap-2 px-2.5 py-1 text-muted-foreground/70 text-sm grid"
            transition:fly={{ y: 10, duration: 200 }}
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
            {:else}
              <!-- Display mode -->
              <div class="col-span-full row-span-full flex flex-1 min-w-0">
                <button
                  class="flex-1 text-left truncate cursor-pointer"
                  transition:slide={{ axis: 'y', duration: 200 }}
                  onclick={() => startEdit(message)}>{message.content}</button
                >
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
