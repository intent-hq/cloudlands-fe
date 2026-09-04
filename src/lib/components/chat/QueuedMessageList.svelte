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
    faArrowRight,
    faRotateRight,
    faFile,
    faChevronDown,
  } from '@fortawesome/free-solid-svg-icons';
  import { tick } from 'svelte';
  import { safeSlide } from '$lib/utils/animations';
  import { beforeFollowBottomMutation } from '$lib/utils/smartScroll';
  import type { QueuedMessage } from '$shared/types';
  import Button from '../ui/button/button.svelte';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import { openWorkspaceAttachment } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { evictAttachmentImageUrl, resolveAttachmentImageUrl } from './attachment-image-url';
  import { store as appStore } from '$store/renderer/store';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { safeSubscriptionSlide } from './subscription-disclosure';
  import {
    cancelQueuedMessageRowMotion,
    captureQueuedMessageRowMotion,
    queuedMessageRowTransition,
  } from './queued-message-row-motion';

  const QUEUE_ACTION_CLUSTER_CLASS =
    'pointer-events-none absolute top-1/2 right-2.5 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none';
  const QUEUE_THREE_ACTION_CONTENT_CLASS = 'box-border pr-24';

  interface Props {
    messages: QueuedMessage[];
    disabled?: boolean;
    onedit?: (
      messageId: string,
      content: string,
      editing?: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    onremove?: (messageId: string) => void;
    onsendnow?: (messageId: string) => void;
    ondone?: () => void;
  }

  let { messages = [], disabled = false, onedit, onremove, onsendnow, ondone }: Props = $props();

  const workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;

  // Track which message is being edited
  let editingId = $state<string | null>(null);
  let editContent = $state('');
  let editOriginalContent = $state('');
  let editStartedProgrammatically = $state(false);
  let editTextarea = $state<HTMLTextAreaElement>();
  let activeEditOperation: { messageId: string } | null = null;
  let pendingFocusRestore: { messageId: string; textarea: HTMLTextAreaElement } | null = null;
  let expanded = $state(true);
  let previousMessageCount = $state(0);
  const contentId = $derived(`queued-messages-content-${messages[0]?.id ?? 'empty'}`);
  const rowElements = new Map<string, HTMLElement>();

  function registerRow(node: HTMLElement, messageId: string) {
    rowElements.set(messageId, node);
    return {
      update(nextId: string) {
        if (nextId === messageId) return;
        rowElements.delete(messageId);
        messageId = nextId;
        rowElements.set(messageId, node);
      },
      destroy() {
        if (rowElements.get(messageId) === node) rowElements.delete(messageId);
        cancelQueuedMessageRowMotion(node);
      },
    };
  }

  function beginRowMotion(messageId: string | null): () => void {
    const row = messageId ? rowElements.get(messageId) : undefined;
    return row ? captureQueuedMessageRowMotion(row) : () => {};
  }

  async function animateRowMutation(messageId: string | null, mutate: () => void) {
    const play = beginRowMotion(messageId);
    mutate();
    await tick();
    play();
  }

  function beginEditOperation(messageId: string) {
    const operation = { messageId };
    activeEditOperation = operation;
    return operation;
  }

  function ownsEditOperation(operation: { messageId: string }) {
    return activeEditOperation === operation && editingId === operation.messageId;
  }

  function finishEditOperation(operation: { messageId: string }) {
    if (!ownsEditOperation(operation)) return false;
    activeEditOperation = null;
    return true;
  }

  function clearEditState(operation?: { messageId: string }) {
    if (operation && !ownsEditOperation(operation)) return false;
    editingId = null;
    editContent = '';
    editOriginalContent = '';
    editStartedProgrammatically = false;
    activeEditOperation = null;
    pendingFocusRestore = null;
    return true;
  }

  async function clearOwnedEditState(operation: { messageId: string }) {
    if (!ownsEditOperation(operation)) return false;
    let cleared = false;
    await animateRowMutation(operation.messageId, () => {
      cleared = clearEditState(operation);
    });
    return cleared;
  }

  // A newly appearing queue starts open. Count changes in a non-empty queue
  // preserve the user's disclosure choice, including while collapsed.
  $effect(() => {
    const count = messages.length;
    if (previousMessageCount === 0 && count > 0) expanded = true;
    previousMessageCount = count;
  });

  $effect(() => {
    if (editingId && !messages.some((message) => message.id === editingId)) clearEditState();
  });

  $effect.pre(() => {
    messages;
    const messageId = editingId;
    const textarea = editTextarea;
    const mutationNode = textarea ?? rowElements.values().next().value;
    const bottomMutation = mutationNode ? beforeFollowBottomMutation(mutationNode) : null;
    const settleBottom = () => {
      bottomMutation?.request();
      bottomMutation?.settle();
    };
    if (!messageId || !textarea || document.activeElement !== textarea) {
      void tick().then(settleBottom);
      return;
    }
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const restore = { messageId, textarea };
    pendingFocusRestore = restore;
    void tick().then(() => {
      settleBottom();
      if (pendingFocusRestore !== restore) return;
      pendingFocusRestore = null;
      if (editingId !== messageId || editTextarea !== textarea) return;
      if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  });

  // Lightbox state for queued image attachments
  let lightboxOpen = $state(false);
  let lightboxImageUrl = $state('');
  let lightboxImageName = $state('');
  let lightboxOpenerElement: HTMLButtonElement | null = $state(null);

  // Resolved workspace-file:// URLs for queued attachment-reference image
  // blocks (monorepo#3338), keyed by attachmentId.
  let referenceImageUrls = $state<Record<string, string>>({});
  // Attachment ids whose resolved <img> failed to load in this instance: they
  // keep the placeholder here (no resolve/fail loop), while the evicted
  // module cache lets the next render elsewhere retry.
  let failedReferenceImages = $state<Record<string, true>>({});
  $effect(() => {
    if (!workspaceId) return;
    for (const message of messages) {
      for (const block of message.imageBlocks ?? []) {
        const attachmentId = block.attachmentId;
        if (
          !attachmentId ||
          referenceImageUrls[attachmentId] !== undefined ||
          failedReferenceImages[attachmentId]
        ) {
          continue;
        }
        void resolveAttachmentImageUrl(workspaceId, attachmentId).then((url) => {
          if (url) referenceImageUrls = { ...referenceImageUrls, [attachmentId]: url };
        });
      }
    }
  });

  /** Renderable src for a queued image block: inline data URL or resolved reference URL. */
  function queuedImageSrc(block: NonNullable<QueuedMessage['imageBlocks']>[number]): string | null {
    if (block.attachmentId) {
      if (failedReferenceImages[block.attachmentId]) return null;
      return referenceImageUrls[block.attachmentId] ?? null;
    }
    if (block.data && block.mimeType) return `data:${block.mimeType};base64,${block.data}`;
    return null;
  }

  // A resolved reference thumbnail failed to load (the protocol handler
  // refused the read, e.g. its backend is disconnected): fall back to the
  // placeholder tile and evict the URL so the next render re-resolves.
  function handleReferenceImageError(
    block: NonNullable<QueuedMessage['imageBlocks']>[number],
    src: string,
  ) {
    const attachmentId = block.attachmentId;
    if (!attachmentId) return;
    console.warn('Attachment thumbnail failed to load', { attachmentId, url: src });
    if (workspaceId) evictAttachmentImageUrl(workspaceId, attachmentId);
    const { [attachmentId]: _dropped, ...rest } = referenceImageUrls;
    referenceImageUrls = rest;
    failedReferenceImages = { ...failedReferenceImages, [attachmentId]: true };
  }

  // Open a queued image attachment in the lightbox
  function openImageLightbox(
    block: NonNullable<QueuedMessage['imageBlocks']>[number],
    openerElement: HTMLButtonElement,
    index: number,
  ) {
    const src = queuedImageSrc(block);
    if (!src) return;
    lightboxImageUrl = src;
    lightboxImageName = m.chat_chatMessage_attachedImage_alt({ number: formatInteger(index + 1) });
    lightboxOpenerElement = openerElement;
    lightboxOpen = true;
  }

  // Click on a queued attachment-reference file chip: the workspace-navigation
  // tab saga resolves the registry row by attachmentId (file.getAttachmentInfo,
  // PROTOCOL §5.9) and opens the stored path in a file tab; missing file →
  // toast. The workspace id is captured from immutable route context at init.
  function openQueuedFileAttachment(block: NonNullable<QueuedMessage['fileBlocks']>[number]) {
    if (!workspaceId) return;
    appStore.dispatch(openWorkspaceAttachment(workspaceId, block.attachmentId, block.fileName));
  }

  // Auto-resize textarea to fit content
  function autoResize(node: HTMLTextAreaElement) {
    const resize = () => {
      const play = beginRowMotion(editingId);
      node.style.height = 'auto';
      node.style.height = node.scrollHeight + 'px';
      play();
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
    const frame = requestAnimationFrame(() => {
      node.focus({ preventScroll: true });
      // Move cursor to end
      node.selectionStart = node.selectionEnd = node.value.length;
    });
    return { destroy: () => cancelAnimationFrame(frame) };
  }

  async function startEdit(message: QueuedMessage, programmatic = false) {
    if (activeEditOperation || editingId === message.id) return;
    const operation = beginEditOperation(message.id);
    await animateRowMutation(message.id, () => {
      editStartedProgrammatically = programmatic;
      editingId = message.id;
      editContent = message.content;
      editOriginalContent = message.content;
    });
    if (!ownsEditOperation(operation)) return;

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
          await clearOwnedEditState(operation);
          return;
        }
      } catch (error) {
        // IPC/network failure - clear edit state
        console.error('Exception while engaging hold for queued message edit:', error);
        await clearOwnedEditState(operation);
        return;
      }
    }
    finishEditOperation(operation);
  }

  async function cancelEdit() {
    if (activeEditOperation || !editingId) return;
    const wasProgrammatic = editStartedProgrammatically;
    const operation = beginEditOperation(editingId);
    const originalContent = editOriginalContent;

    // STAB-27: Release hold with original content (editing:false) BEFORE clearing edit state
    // so if the release fails, we stay in edit mode and the user can retry
    if (onedit) {
      try {
        const result = await onedit(operation.messageId, originalContent, false);
        if (!result.success) {
          // Release failed - stay in edit mode
          console.error('Failed to release queued message hold on cancel:', result.error);
          finishEditOperation(operation);
          return;
        }
      } catch (error) {
        // IPC/network failure - stay in edit mode
        console.error('Exception while releasing queued message hold on cancel:', error);
        finishEditOperation(operation);
        return;
      }
    }

    // Only clear edit state after successful release
    const cleared = await clearOwnedEditState(operation);

    if (cleared && wasProgrammatic) ondone?.();
  }

  async function saveEdit() {
    if (activeEditOperation) return;
    if (editingId && editContent.trim()) {
      const wasProgrammatic = editStartedProgrammatically;
      const operation = beginEditOperation(editingId);
      const newContent = editContent.trim();

      // STAB-27: Save with edited content and release hold (editing:false triggers self-drain)
      // Do this BEFORE clearing edit state so if it fails, we stay in edit mode
      if (onedit) {
        try {
          const result = await onedit(operation.messageId, newContent, false);
          if (!result.success) {
            // Save failed - stay in edit mode
            console.error('Failed to save queued message edit:', result.error);
            finishEditOperation(operation);
            return;
          }
        } catch (error) {
          // IPC/network failure - stay in edit mode
          console.error('Exception while saving queued message edit:', error);
          finishEditOperation(operation);
          return;
        }
      }

      // Only clear edit state after successful save
      const cleared = await clearOwnedEditState(operation);

      if (cleared && wasProgrammatic) ondone?.();
    } else if (editingId) {
      await cancelEdit();
    }
  }

  function handleEditBlur(event: FocusEvent) {
    const textarea = event.currentTarget as HTMLTextAreaElement;
    const restore = pendingFocusRestore;
    const isOwnedReorderBlur =
      restore?.textarea === textarea && restore.messageId === editingId && !event.relatedTarget;
    if (isOwnedReorderBlur) return;
    if (restore?.textarea === textarea) pendingFocusRestore = null;
    void saveEdit();
  }

  function handleRemove(id: string) {
    onremove?.(id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void cancelEdit();
    }
  }

  /**
   * Exposed function for parent components to programmatically start editing
   * the last queued message (e.g., when user presses Up arrow in chat input).
   * Returns true if editing was started, false if no messages to edit.
   */
  export function editLastMessage(): boolean {
    const last = messages[messages.length - 1];
    if (!last) return false;
    void startEdit(last, true);
    return true;
  }
</script>

{#snippet imageThumbnails(message: QueuedMessage)}
  {#if message.imageBlocks && message.imageBlocks.length > 0}
    <div class="inline-flex items-center gap-1 shrink-0">
      {#each message.imageBlocks as block, i (i)}
        {@const src = queuedImageSrc(block)}
        <button
          type="button"
          class="inline-flex shrink-0 p-0 border-0 bg-transparent cursor-pointer align-text-bottom rounded-sm focus:outline-none focus:ring-1 focus:ring-primary"
          data-testid="queued-image-thumbnail"
          onclick={(e) => {
            e.stopPropagation();
            openImageLightbox(block, e.currentTarget, i);
          }}
          aria-label={m.chat_chatMessage_viewAttachedImage_ariaLabel({
            number: formatInteger(i + 1),
            total: formatInteger(message.imageBlocks?.length ?? 0),
          })}
        >
          {#if src}
            <img
              {src}
              alt={m.chat_chatMessage_attachedImage_alt({ number: formatInteger(i + 1) })}
              class="h-[1.1em] w-[1.1em] rounded-sm border border-border object-cover hover:opacity-90 transition-opacity"
              onerror={() => handleReferenceImageError(block, src)}
            />
          {:else}
            <!-- Reference still resolving, failed to load, or its file is
             gone: neutral placeholder tile instead of a broken img. -->
            <span
              class="h-[1.1em] w-[1.1em] rounded-sm border border-border bg-muted/50 inline-block"
              data-testid="queued-image-placeholder"
            ></span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet fileChips(message: QueuedMessage)}
  {#if message.fileBlocks && message.fileBlocks.length > 0}
    <div class="inline-flex items-center gap-1 shrink-0">
      {#each message.fileBlocks as block, i (i)}
        <button
          type="button"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted/50 hover:bg-muted transition-colors text-[0.7rem] text-muted-foreground hover:text-foreground cursor-pointer"
          data-testid="queued-file-chip"
          onclick={(e) => {
            e.stopPropagation();
            openQueuedFileAttachment(block);
          }}
          title={m.chat_chatMessage_openAttachment_title({ name: block.fileName })}
        >
          <Fa icon={faFile} class="w-2.5 h-2.5" />
          <span class="truncate max-w-[120px]">{block.fileName}</span>
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

{#if messages.length > 0}
  <div
    class="queued-messages-surface relative z-20 px-2 pt-3 pb-2"
    data-testid="queued-messages-container"
    transition:safeSlide={{ duration: 200 }}
  >
    <button
      type="button"
      class="type-caption flex w-full cursor-pointer items-center rounded border-0 bg-transparent px-2.5 py-0 text-left text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={expanded}
      aria-controls={contentId}
      data-testid="queued-messages-disclosure"
      onclick={() => (expanded = !expanded)}
    >
      <span class="min-w-0 flex-1 truncate" aria-live="polite" data-testid="queued-messages-label">
        {messages.length === 1
          ? m.chat_queuedMessages_header_one()
          : m.chat_queuedMessages_header_many({ count: formatInteger(messages.length) })}
      </span>
      <span
        class="ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center"
        data-testid="queued-messages-chevron"
        aria-hidden="true"
      >
        <Fa
          icon={faChevronDown}
          class="h-4! w-4! opacity-60 transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none {expanded
            ? ''
            : 'rotate-90'}"
        />
      </span>
    </button>

    {#if expanded}
      <div
        id={contentId}
        class="pt-2"
        data-testid="queued-messages-content"
        transition:safeSubscriptionSlide
      >
        <div class="space-y-px">
          {#each messages as message (message.id)}
            <div
              class="group relative type-body flex items-start gap-2 px-2.5 py-1 text-subtle {message.editing
                ? 'opacity-60'
                : ''}"
              data-testid="queued-message-row"
              data-message-id={message.id}
              use:registerRow={message.id}
              transition:queuedMessageRowTransition
              title={message.editing ? m.chat_queuedMessages_heldForEditing_title() : undefined}
            >
              {#if editingId === message.id}
                <!-- Edit mode -->
                <div
                  class="col-span-full row-span-full flex-1 flex gap-2 flex"
                  data-testid="queued-message-edit-mode"
                >
                  <textarea
                    bind:this={editTextarea}
                    bind:value={editContent}
                    onkeydown={handleKeydown}
                    use:autofocusAction
                    use:autoResize
                    onblur={handleEditBlur}
                    rows="1"
                    class="type-body flex-1 resize-none overflow-hidden rounded py-0! text-foreground focus:outline-none! focus:ring-0!"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"></textarea>
                  <Button
                    variant="ghost-light"
                    size="icon-xs"
                    class="-my-1"
                    onclick={saveEdit}
                    onpointerdown={(event) => event.preventDefault()}
                    tooltip={m.chat_queuedMessages_save_tooltip()}
                  >
                    <Fa icon={faCheck} class="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost-light"
                    size="icon-xs"
                    class="-my-1"
                    onclick={cancelEdit}
                    onpointerdown={(event) => event.preventDefault()}
                    tooltip={m.chat_queuedMessages_cancel_tooltip()}
                  >
                    <Fa icon={faTimes} class="w-3 h-3" />
                  </Button>
                </div>
              {:else}
                <!-- Display mode -->
                <div class="col-span-full row-span-full flex flex-1 min-w-0 gap-2">
                  {#if message.requeuedAfterFailure}
                    <div
                      class="type-caption flex shrink-0 items-center gap-1 text-warning"
                      title={m.chat_queuedMessages_failedWillRetry_label()}
                    >
                      <div aria-hidden="true">
                        <Fa icon={faRotateRight} class="w-3 h-3" />
                      </div>
                      <span class="sr-only">{m.chat_queuedMessages_failedWillRetry_label()}</span>
                    </div>
                  {/if}
                  {@render imageThumbnails(message)}
                  {@render fileChips(message)}
                  <button
                    class="flex-1 min-w-0 text-left cursor-pointer {QUEUE_THREE_ACTION_CONTENT_CLASS}"
                    data-testid="queued-message-content"
                    data-mode="display"
                    onclick={() => startEdit(message)}
                  >
                    <span class="block truncate" data-testid="queued-message-text">
                      {message.requeuedAfterFailure
                        ? m.chat_queuedMessages_failedWillRetryPrefix_label() + ' '
                        : ''}{message.content}
                    </span>
                  </button>
                  {#if !disabled}
                    <div class={QUEUE_ACTION_CLUSTER_CLASS} data-testid="queued-message-actions">
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="-my-1"
                        onclick={() => onsendnow?.(message.id)}
                        tooltip={m.chat_queuedMessages_sendNow_tooltip()}
                      >
                        <Fa icon={faArrowRight} class="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="-my-1"
                        onclick={() => startEdit(message)}
                        tooltip={m.chat_queuedMessages_edit_tooltip()}
                      >
                        <Fa icon={faPen} class="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="-my-1"
                        onclick={() => handleRemove(message.id)}
                        tooltip={m.chat_queuedMessages_remove_tooltip()}
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
  </div>
{/if}

<!-- Image Lightbox for queued message attachments -->
<ImageLightbox
  bind:open={lightboxOpen}
  imageUrl={lightboxImageUrl}
  imageName={lightboxImageName}
  openerElement={lightboxOpenerElement}
/>
