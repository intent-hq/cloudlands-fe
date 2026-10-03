<script lang="ts">
  import { USER_MESSAGE_TEXT_CLASS } from './user-message-surface';
  import {
    findQueuedMessageForEdit,
    isQueuedMessageReadyForBatch,
    queuedMessagePermissions,
  } from '$lib/utils/queued-message-permissions';
  import { memberMentionsToText } from '$lib/utils/member-mention-token';
  import Fa from 'svelte-fa';
  import { faCheck, faArrowUp } from '@fortawesome/free-solid-svg-icons';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
  import ArrowUUpLeftIcon from 'phosphor-svelte/lib/ArrowUUpLeftIcon';
  import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLineIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import { tick } from 'svelte';
  import { Spring } from '$lib/motion';
  import { safeDisclosureTransition } from './disclosure-motion';
  import { beforeFollowBottomMutation } from '$lib/utils/smartScroll';
  import type { MessageAuthor, QueuedMessage } from '$shared/types';
  import type { QueuedMessageSendOutcome } from '$store/renderer/slices/chat-state/chat-state-types';
  import * as authorship from '$lib/utils/message-authorship';
  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import TipTapEditor from './input/TipTapEditor.svelte';
  import QueuedMessageAttachments from './QueuedMessageAttachments.svelte';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { openWorkspaceAttachment } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { evictAttachmentImageUrl, resolveAttachmentImageUrl } from './attachment-image-url';
  import { store as appStore } from '$store/renderer/store';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
    cancelQueuedMessageRowMotion,
    captureQueuedMessageRowMotion,
    queuedMessageRowTransition,
  } from './queued-message-row-motion';

  const QUEUE_ACTION_CLUSTER_CLASS =
    'pointer-events-none flex shrink-0 items-center opacity-0 transition-opacity duration-spring-fast ease-spring-fast group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none';

  interface Props {
    messages: QueuedMessage[];
    disabled?: boolean;
    onedit?: (
      messageId: string,
      content: string,
      editing?: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    onremove?: (messageId: string) => void;
    onsendnow?: (
      messageId: string,
    ) => QueuedMessageSendOutcome | void | Promise<QueuedMessageSendOutcome | void>;
    onsendall?: (messageIds: string[]) => Promise<QueuedMessageSendOutcome | void>;
    onclearall?: (messageIds: string[]) => Promise<void>;
    ondone?: () => void;
    /**
     * Local queue attribution (multiplayer w2). `null` disables local fallback
     * in a single-member workspace. Portable author snapshots remain visible
     * independently. Otherwise a user-authored entry renders its own `author`
     * projection, or — on a daemon that stamps `fromPrincipalId` only — the
     * transcript author this map resolves it to.
     */
    authors?: ReadonlyMap<string, MessageAuthor> | null;
    /**
     * The admitted principal used for authorization; never inferred from presence.
     * Null keeps all mutations disabled until identity is verified.
     */
    ownPrincipalId?: string | null;
    /** Presence identity affects attribution display only. */
    presentationPrincipalId?: string | null;
    ownerPrincipalId?: string | null;
    isHostOwner?: boolean;
  }

  let {
    messages = [],
    disabled = false,
    onedit,
    onremove,
    onsendnow,
    onsendall,
    onclearall,
    ondone,
    authors = null,
    ownPrincipalId = null,
    presentationPrincipalId = ownPrincipalId,
    ownerPrincipalId = null,
    isHostOwner = false,
  }: Props = $props();

  const workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;

  function permissions(message: QueuedMessage | undefined) {
    return queuedMessagePermissions(message, ownPrincipalId, ownerPrincipalId, isHostOwner);
  }

  function canStartEdit(message: QueuedMessage) {
    return (
      permissions(message).edit &&
      !(message.editing && message.editingMessageId && message.editingMessageId !== message.id)
    );
  }

  // Track which message is being edited
  let editingId = $state<string | null>(null);
  let conflictedDrafts = $state<
    Array<{ id: string; content: string; pendingOperationId?: number }>
  >([]);
  let editContent = $state('');
  let editOriginalContent = $state('');
  let editStartedProgrammatically = $state(false);
  let editTextarea = $state<HTMLTextAreaElement>();
  let editRichEditor = $state<TipTapEditor>();
  let editRichContainer = $state<HTMLDivElement>();
  const editHasMembers = $derived(
    memberMentionsToText(editOriginalContent) !== editOriginalContent,
  );
  type EditOperation = { messageId: string; token: number; releasing: boolean };
  let editOperationSequence = 0;
  let activeEditOperation: EditOperation | null = null;
  let pendingFocusRestore: { messageId: string; element: HTMLElement } | null = null;
  let expanded = $state(true);
  let showAll = $state(false);
  let bodyHeight = $state(0);
  let viewportHeight = $state(0);
  let viewport = $state<HTMLDivElement>();
  let previewExpander = $state<HTMLButtonElement | null>(null);
  let disclosureButton = $state<HTMLButtonElement | null>(null);
  const previewHeight = new Spring(0, 'moderate');
  let heightInitialized = false;
  const clipped = $derived(!showAll && bodyHeight > Math.min(viewportHeight, 144) + 1);
  let sendStates = $state<Record<string, 'sending' | QueuedMessageSendOutcome | undefined>>({});
  let bulkAction = $state<'send' | 'clear' | null>(null);
  let bulkError = $state<string | null>(null);
  const queueSending = $derived(
    bulkAction === 'send' || messages.some((message) => isSending(message.id)),
  );
  const busy = $derived(
    bulkAction !== null ||
      Object.values(sendStates).some((state) => state === 'sending' || state === 'delivered'),
  );
  let readinessTime = $state(Date.now());
  $effect(() => {
    if (!messages.some((message) => message.holdKind !== undefined)) return;
    readinessTime = Date.now();
    const timer = setInterval(() => {
      readinessTime = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  const readyIds = $derived(
    messages
      .filter(
        (message) =>
          permissions(message).sendNow &&
          isQueuedMessageReadyForBatch(message, readinessTime) &&
          message.id !== editingId &&
          !isSending(message.id),
      )
      .map((message) => message.id),
  );
  const removableIds = $derived(
    messages.filter((message) => permissions(message).remove).map((message) => message.id),
  );
  let previousMessageCount = $state(0);
  const contentId = $derived(`queued-messages-content-${messages[0]?.id ?? 'empty'}`);
  const headerLabel = $derived(
    queueSending
      ? m.chat_queuedMessages_sending_label()
      : messages.length === 1
        ? m.chat_queuedMessages_header_one()
        : m.chat_queuedMessages_header_many({ count: formatInteger(messages.length) }),
  );
  const rowElements = new Map<string, HTMLElement>();
  let sendErrors = $state<Record<string, string | undefined>>({});
  const sendingIds = new Set<string>();

  $effect(() => {
    if (!bodyHeight) return;
    void previewHeight.set(showAll ? bodyHeight : Math.min(bodyHeight, 144), {
      instant: !heightInitialized,
    });
    heightInitialized = true;
  });

  function expandPreview() {
    showAll = true;
  }

  async function collapsePreview() {
    showAll = false;
    void previewHeight.set(Math.min(bodyHeight, 144), { instant: true });
    if (viewport) viewport.scrollTop = 0;
    await tick();
    // Make the replacement control available before moving focus to it.
    if (viewport) viewportHeight = viewport.clientHeight;
    await tick();
    (previewExpander ?? disclosureButton)?.focus({ preventScroll: true });
  }

  function toggleExpanded() {
    if (!expanded) {
      showAll = false;
      // The disclosure measures its target before the next resize delivery.
      // Discard the full preview's tween so reopening starts at the compact size.
      void previewHeight.set(Math.min(bodyHeight, 144), { instant: true });
    }
    expanded = !expanded;
  }

  function revealFocusedMessage(target: HTMLElement) {
    if (!clipped || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const visibleBottom = Math.min(
      bounds.bottom,
      previewExpander?.getBoundingClientRect().top ?? bounds.bottom,
    );
    if (
      viewport.scrollTop === 0 &&
      targetBounds.top >= bounds.top &&
      targetBounds.bottom <= visibleBottom
    )
      return;
    showAll = true;
    void tick().then(() => {
      if (viewport && target.isConnected) {
        viewport.scrollTop += Math.max(
          0,
          target.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom,
        );
      }
    });
  }

  async function handleBulkAction(action: 'send' | 'clear') {
    if (disabled || busy || (action === 'send' ? !onsendall : !onclearall)) return;
    const ids =
      action === 'send'
        ? readyIds.filter((id) => {
            const message = messages.find((entry) => entry.id === id);
            return message && isQueuedMessageReadyForBatch(message);
          })
        : [...removableIds];
    if (!ids.length) return;
    bulkAction = action;
    bulkError = null;
    if (action === 'send') for (const id of ids) sendStates[id] = 'sending';
    try {
      if (action === 'send') {
        const outcome = await onsendall!(ids);
        for (const id of ids)
          if (messages.some((entry) => entry.id === id)) sendStates[id] = outcome ?? undefined;
        if (outcome === 'queued' || outcome === 'quarantined') expanded = true;
      } else {
        await onclearall!(ids);
      }
    } catch (error) {
      for (const id of ids) if (action === 'send') delete sendStates[id];
      bulkError =
        action === 'send'
          ? m.chat_queuedMessages_sendFailed_error({
              error: error instanceof Error ? error.message : String(error),
            })
          : m.chat_queuedMessages_clearFailed_error({
              error: error instanceof Error ? error.message : String(error),
            });
    } finally {
      bulkAction = null;
    }
  }

  function isSending(id: string) {
    return sendStates[id] === 'sending' || sendStates[id] === 'delivered';
  }

  $effect(() => {
    const ids = new Set(messages.map((message) => message.id));
    for (const id of Object.keys(sendStates)) {
      if (!ids.has(id)) delete sendStates[id];
    }
    for (const id of Object.keys(sendErrors)) {
      if (!ids.has(id)) delete sendErrors[id];
    }
  });

  async function handleSendNow(id: string) {
    const message = messages.find((entry) => entry.id === id);
    if (
      !onsendnow ||
      disabled ||
      bulkAction ||
      !message ||
      !permissions(message).sendNow ||
      message.editing ||
      editingId === id ||
      sendingIds.has(id) ||
      isSending(id)
    )
      return;
    sendingIds.add(id);
    sendStates[id] = 'sending';
    delete sendErrors[id];
    try {
      const outcome = await onsendnow(id);
      if (messages.some((entry) => entry.id === id)) sendStates[id] = outcome ?? undefined;
    } catch (error) {
      if (messages.some((entry) => entry.id === id)) {
        delete sendStates[id];
        sendErrors[id] = m.chat_queuedMessages_sendFailed_error({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      sendingIds.delete(id);
    }
  }

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

  function beginEditOperation(messageId: string, releasing = false) {
    const operation = { messageId, token: ++editOperationSequence, releasing };
    activeEditOperation = operation;
    return operation;
  }

  function ownsEditOperation(operation: EditOperation) {
    return activeEditOperation === operation && editingId === operation.messageId;
  }

  function finishEditOperation(operation: EditOperation) {
    if (!ownsEditOperation(operation)) return false;
    activeEditOperation = null;
    return true;
  }

  function clearEditState(operation?: EditOperation) {
    if (operation && !ownsEditOperation(operation)) return false;
    editingId = null;
    editContent = '';
    editOriginalContent = '';
    editStartedProgrammatically = false;
    activeEditOperation = null;
    pendingFocusRestore = null;
    return true;
  }

  function preserveConflictedDraft(pendingOperationId?: number) {
    if (editingId) {
      conflictedDrafts = [
        ...conflictedDrafts.filter((draft) => draft.id !== editingId),
        { id: editingId, content: editContent, pendingOperationId },
      ];
    }
    clearEditState();
  }

  // Queue events may release or drain a row before its save/cancel reply. Keep
  // that draft private until the reply settles, without blocking another editor.
  function settleDetachedEdit(operation: EditOperation, success: boolean) {
    if (!conflictedDrafts.some((draft) => draft.pendingOperationId === operation.token))
      return false;
    conflictedDrafts = conflictedDrafts.flatMap((draft) => {
      if (draft.pendingOperationId !== operation.token) return [draft];
      return success ? [] : [{ id: draft.id, content: draft.content }];
    });
    return true;
  }

  function preserveServerConflict(error: string | undefined, operation: EditOperation) {
    if (settleDetachedEdit(operation, false)) return true;
    if (!ownsEditOperation(operation) || !error?.includes('queued edit conflict:')) return false;
    preserveConflictedDraft();
    return true;
  }

  async function clearOwnedEditState(operation: EditOperation) {
    if (settleDetachedEdit(operation, true)) return false;
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
    if (previousMessageCount === 0 && count > 0) {
      expanded = true;
      showAll = false;
      bulkError = null;
    }
    previousMessageCount = count;
  });

  $effect(() => {
    if (editingId && !findQueuedMessageForEdit(messages, editingId)) {
      preserveConflictedDraft(
        activeEditOperation?.releasing ? activeEditOperation.token : undefined,
      );
    }
  });

  $effect.pre(() => {
    messages;
    const messageId = editingId;
    const textarea = editTextarea;
    const richEditor = editRichEditor;
    const input = textarea ?? editRichContainer?.querySelector<HTMLElement>('[role="textbox"]');
    const mutationNode = input ?? rowElements.values().next().value;
    const bottomMutation = mutationNode ? beforeFollowBottomMutation(mutationNode) : null;
    const settleBottom = () => {
      bottomMutation?.request();
      bottomMutation?.settle();
    };
    if (!messageId || !input || document.activeElement !== input) {
      void tick().then(settleBottom);
      return;
    }
    const selectionStart = textarea?.selectionStart;
    const selectionEnd = textarea?.selectionEnd;
    const restore = { messageId, element: input };
    pendingFocusRestore = restore;
    void tick().then(() => {
      settleBottom();
      if (pendingFocusRestore !== restore) return;
      pendingFocusRestore = null;
      if (editingId !== messageId || !input.isConnected) return;
      if (textarea && editTextarea === textarea) {
        if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(selectionStart!, selectionEnd!);
      } else if (richEditor === editRichEditor && document.activeElement !== input) {
        richEditor?.focus();
      }
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

  $effect(() => {
    const textarea = editTextarea;
    if (!textarea) return;
    const autofocus = autofocusAction(textarea);
    const resize = autoResize(textarea);
    return () => {
      autofocus.destroy();
      resize.destroy();
    };
  });

  $effect(() => {
    const richEditor = editRichEditor;
    if (!richEditor) return;
    const frame = requestAnimationFrame(() => richEditor.focusEnd());
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    bodyHeight;
    const input = editTextarea ?? editRichContainer?.querySelector<HTMLElement>('[role="textbox"]');
    if (!input) return;
    void tick().then(() => {
      if (input === document.activeElement) revealFocusedMessage(input);
    });
  });

  async function startEdit(message: QueuedMessage, programmatic = false) {
    if (
      !canStartEdit(message) ||
      disabled ||
      bulkAction ||
      isSending(message.id) ||
      activeEditOperation ||
      editingId === message.id
    )
      return;
    expanded = true;
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
          if (preserveServerConflict(result.error, operation)) return;
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
    if (
      activeEditOperation ||
      !editingId ||
      !permissions(findQueuedMessageForEdit(messages, editingId)).edit
    )
      return;
    const wasProgrammatic = editStartedProgrammatically;
    const operation = beginEditOperation(editingId, true);
    const originalContent = editOriginalContent;

    // STAB-27: Release hold with original content (editing:false) BEFORE clearing edit state
    // so if the release fails, we stay in edit mode and the user can retry
    if (onedit) {
      try {
        const result = await onedit(operation.messageId, originalContent, false);
        if (!result.success) {
          if (preserveServerConflict(result.error, operation)) return;
          // Release failed - stay in edit mode
          console.error('Failed to release queued message hold on cancel:', result.error);
          finishEditOperation(operation);
          return;
        }
      } catch (error) {
        // IPC/network failure - stay in edit mode
        console.error('Exception while releasing queued message hold on cancel:', error);
        if (settleDetachedEdit(operation, false)) return;
        finishEditOperation(operation);
        return;
      }
    }

    // Only clear edit state after successful release
    const cleared = await clearOwnedEditState(operation);

    if (cleared && wasProgrammatic) ondone?.();
  }

  async function saveEdit() {
    if (activeEditOperation || !permissions(findQueuedMessageForEdit(messages, editingId)).edit)
      return;
    if (editingId && editContent.trim()) {
      const wasProgrammatic = editStartedProgrammatically;
      const operation = beginEditOperation(editingId, true);
      const newContent = editContent.trim();

      // STAB-27: Save with edited content and release hold (editing:false triggers self-drain)
      // Do this BEFORE clearing edit state so if it fails, we stay in edit mode
      if (onedit) {
        try {
          const result = await onedit(operation.messageId, newContent, false);
          if (!result.success) {
            if (preserveServerConflict(result.error, operation)) return;
            // Save failed - stay in edit mode
            console.error('Failed to save queued message edit:', result.error);
            finishEditOperation(operation);
            return;
          }
        } catch (error) {
          // IPC/network failure - stay in edit mode
          console.error('Exception while saving queued message edit:', error);
          if (settleDetachedEdit(operation, false)) return;
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
    const input = event.target as HTMLElement;
    if (editRichContainer?.contains(event.relatedTarget as Node | null)) return;
    const restore = pendingFocusRestore;
    const isOwnedReorderBlur =
      restore?.element === input && restore.messageId === editingId && !event.relatedTarget;
    if (isOwnedReorderBlur) return;
    if (restore?.element === input) pendingFocusRestore = null;
    void saveEdit();
  }

  function handleRemove(id: string) {
    if (
      disabled ||
      bulkAction ||
      !permissions(messages.find((message) => message.id === id)).remove ||
      isSending(id) ||
      sendingIds.has(id)
    )
      return;
    onremove?.(id);
  }

  function handleDisplayKeydown(event: KeyboardEvent, message: QueuedMessage) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSendNow(message.id);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      void startEdit(message);
    } else if (event.key === 'Delete' && !disabled) {
      event.preventDefault();
      handleRemove(message.id);
    }
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
    const last = messages.findLast(canStartEdit);
    if (!last || disabled || activeEditOperation || editingId === last.id || isSending(last.id))
      return false;
    void startEdit(last, true);
    return true;
  }
</script>

{#each conflictedDrafts.filter((draft) => draft.pendingOperationId === undefined) as draft (draft.id)}
  <div
    class="border-b border-border p-3 space-y-2"
    data-testid="queued-draft-conflict"
    data-conflict-message-id={draft.id}
  >
    <p class="type-caption text-warning-ink" role="status">
      {m.chat_queuedMessages_draftConflict_description()}
    </p>
    <pre class="type-body whitespace-pre-wrap break-words select-text">{draft.content}</pre>
    <div class="flex items-center gap-2">
      <CopyButton text={draft.content} />
      <Button
        type="button"
        variant="plain"
        onclick={() => {
          conflictedDrafts = conflictedDrafts.filter((item) => item.id !== draft.id);
        }}
      >
        {m.chat_queuedMessages_discardDraft_label()}
      </Button>
    </div>
  </div>
{/each}

{#if messages.length > 0}
  <div
    class="queued-messages-surface relative z-20 mt-auto w-full min-w-0 rounded-xl bg-sidebar p-1.5"
    class:pt-0={expanded}
    data-testid="queued-messages-container"
    transition:safeDisclosureTransition|global={{ tier: 'moderate' }}
  >
    <div
      class="queued-messages-header sticky top-0 z-10 flex min-w-0 items-center bg-sidebar"
      data-testid="queued-messages-header"
    >
      <Button
        bind:ref={disclosureButton}
        type="button"
        variant="plain"
        size="compact"
        class="type-caption flex min-h-8 min-w-0 flex-1 cursor-pointer items-center rounded-lg border-0 bg-sidebar px-1.5! py-1 text-left text-muted-foreground"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={headerLabel}
        aria-live="polite"
        title={headerLabel}
        data-testid="queued-messages-disclosure"
        onclick={toggleExpanded}
      >
        <span class="min-w-0 flex-1 truncate" data-testid="queued-messages-label">
          {queueSending
            ? m.chat_queuedMessages_sending_label()
            : m.chat_queuedMessages_sendingWhenIdle_label()}
        </span>
      </Button>
      {#if !disabled}
        {#if onsendall && messages.some((message) => permissions(message).sendNow)}
          <Button
            variant="ghost-light"
            size="icon-xs"
            iconOnly
            aria-label={m.chat_queuedMessages_sendAll_ariaLabel()}
            tooltip={m.chat_queuedMessages_sendAll_label()}
            disabled={busy || readyIds.length === 0}
            loading={bulkAction === 'send'}
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => handleBulkAction('send')}
          >
            <Fa icon={faArrowUp} class="h-3 w-3" />
          </Button>
        {/if}
        {#if onclearall && removableIds.length > 0}
          <Button
            variant="ghost-light"
            size="icon-xs"
            iconOnly
            aria-label={m.chat_queuedMessages_clearAll_ariaLabel()}
            tooltip={m.chat_queuedMessages_clearAll_label()}
            disabled={busy}
            loading={bulkAction === 'clear'}
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => handleBulkAction('clear')}
          >
            <XIcon size={13} weight="regular" aria-hidden="true" />
          </Button>
        {/if}
      {/if}
    </div>
    {#if bulkError}
      <div class="type-caption px-1.5 pb-1 text-warning-ink" role="alert">{bulkError}</div>
    {/if}

    {#if expanded}
      <div
        id={contentId}
        data-testid="queued-messages-content"
        transition:safeDisclosureTransition={{ tier: 'moderate' }}
      >
        <div
          class="queued-messages-body relative flex flex-col overflow-hidden rounded-lg bg-background"
        >
          <div
            id="{contentId}-viewport"
            bind:this={viewport}
            bind:clientHeight={viewportHeight}
            class="queued-messages-viewport min-h-0 min-w-0 overscroll-contain {showAll
              ? 'overflow-y-auto'
              : 'overflow-hidden'}"
            class:queued-messages-preview={!showAll}
            style:height={bodyHeight > 0 ? `${previewHeight.current}px` : undefined}
            data-testid="queued-messages-viewport"
            onfocusin={(event) => revealFocusedMessage(event.target as HTMLElement)}
          >
            <div class="flex min-w-0 flex-col py-2" bind:clientHeight={bodyHeight}>
              {#each messages as message (message.id)}
                {@const sending = sendStates[message.id] === 'sending'}
                <div
                  class="group relative type-body flex min-h-(--control-height-compact) select-none items-start gap-2 px-3 py-1 font-normal! text-secondary-foreground {message.editing
                    ? 'opacity-60'
                    : ''}"
                  data-testid="queued-message-row"
                  data-message-id={message.id}
                  aria-busy={sending || undefined}
                  use:registerRow={message.id}
                  transition:queuedMessageRowTransition
                  title={message.editing ? m.chat_queuedMessages_heldForEditing_title() : undefined}
                >
                  {#if editingId && findQueuedMessageForEdit([message], editingId)}
                    <!-- Edit mode -->
                    <div
                      class="col-span-full row-span-full min-w-0 flex flex-1 gap-2"
                      data-testid="queued-message-edit-mode"
                    >
                      {#if editHasMembers}
                        <div
                          bind:this={editRichContainer}
                          class="min-w-0 flex-1 text-foreground"
                          role="group"
                          onfocusout={handleEditBlur}
                        >
                          <TipTapEditor
                            bind:this={editRichEditor}
                            value={editContent}
                            onUpdate={(content) => (editContent = content)}
                            onSubmit={saveEdit}
                            onForceSubmit={saveEdit}
                            onEscape={cancelEdit}
                            minHeight={0}
                            editorClassName="type-body! p-0! font-normal! [&_.mention-chip]:py-0! [&_.mention-chip]:leading-[inherit]!"
                          />
                        </div>
                      {:else}
                        <Textarea
                          bind:ref={editTextarea}
                          bind:value={editContent}
                          onkeydown={handleKeydown}
                          onblur={handleEditBlur}
                          rows={1}
                          noFocusStyle
                          class="type-body min-h-0 min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 font-normal! text-foreground shadow-none hover:bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none"
                          autocorrect="off"
                          autocapitalize="off"
                          spellcheck="false"
                        />
                      {/if}
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
                        <ArrowUUpLeftIcon size={16} weight="regular" aria-hidden="true" />
                      </Button>
                    </div>
                  {:else}
                    {@const queuedAuthor = authorship.getQueuedMessageAuthor(
                      message,
                      authors,
                      presentationPrincipalId,
                    )}
                    {@const queuedAuthorLabel = queuedAuthor
                      ? authorship.getMessageAuthorLabel(queuedAuthor)
                      : null}
                    <!-- Display mode -->
                    <div class="queued-message-display flex min-w-0 flex-1 items-start gap-2">
                      {#if queuedAuthor}
                        <Tooltip
                          class="first-line-icon"
                          content={authorship.getMessageAuthorTooltip(queuedAuthor)}
                        >
                          <span
                            role="img"
                            data-testid="queued-message-author"
                            data-principal-id={queuedAuthor.principalId}
                            aria-label={m.chat_queuedMessages_author_ariaLabel({
                              name: queuedAuthorLabel ?? m.chat_chatMessage_authorUnknown_label(),
                            })}
                          >
                            <PrincipalAvatar
                              avatarUrl={queuedAuthor.avatarUrl}
                              label={queuedAuthor.displayName?.trim() ||
                                queuedAuthor.login?.trim() ||
                                ''}
                              size={16}
                              class="font-medium leading-none text-muted-foreground"
                              referrerpolicy="no-referrer"
                              testid="queued-message-author-avatar"
                            />
                          </span>
                        </Tooltip>
                      {/if}
                      <div class="queued-message-body min-w-0 flex-1">
                        <QueuedMessageAttachments
                          {message}
                          {queuedImageSrc}
                          {openImageLightbox}
                          {handleReferenceImageError}
                          {openQueuedFileAttachment}
                        />
                        <Button
                          variant="plain"
                          size="compact"
                          class="type-body h-auto min-h-0 w-full min-w-0 cursor-default justify-start whitespace-normal p-0 text-left font-normal!"
                          truncateLabel={false}
                          labelClass="block!"
                          data-testid="queued-message-content"
                          data-mode="display"
                          aria-label={memberMentionsToText(message.content)}
                          ondblclick={() => startEdit(message)}
                          onkeydown={(event) => handleDisplayKeydown(event, message)}
                        >
                          <span
                            class="block whitespace-pre-wrap wrap-anywhere {USER_MESSAGE_TEXT_CLASS}"
                            data-testid="queued-message-text"
                          >
                            {memberMentionsToText(message.content)}
                          </span>
                        </Button>
                        {#if message.requeuedAfterFailure && !isSending(message.id)}
                          <div
                            class="type-caption mt-0.5 flex items-start gap-1 text-warning-ink"
                            data-testid="queued-message-retry-status"
                            role="status"
                          >
                            <span class="first-line-icon" aria-hidden="true">
                              <ArrowClockwiseIcon size={12} weight="regular" />
                            </span>
                            <span>{m.chat_queuedMessages_failedWillRetry_label()}</span>
                          </div>
                        {/if}
                      </div>
                      {#if !disabled}
                        <div
                          class="queued-message-actions {QUEUE_ACTION_CLUSTER_CLASS}"
                          data-testid="queued-message-actions"
                        >
                          {#if permissions(message).edit}
                            <Button
                              variant="ghost-light"
                              size="icon-xs"
                              iconOnly
                              class="-my-1"
                              aria-label={m.chat_queuedMessages_edit_tooltip()}
                              disabled={bulkAction !== null ||
                                isSending(message.id) ||
                                !canStartEdit(message)}
                              onpointerdown={(event) => event.stopPropagation()}
                              onclick={(event) => {
                                event.stopPropagation();
                                void startEdit(message);
                              }}
                              tooltip={m.chat_queuedMessages_edit_tooltip()}
                            >
                              <PencilSimpleLineIcon size={16} weight="regular" aria-hidden="true" />
                            </Button>
                          {/if}
                          {#if onsendnow && permissions(message).sendNow}
                            <Button
                              variant="ghost-light"
                              size="icon-xs"
                              iconOnly
                              class="-my-1"
                              aria-label={sending
                                ? m.chat_queuedMessages_sending_label()
                                : m.chat_queuedMessages_sendImmediately_label()}
                              loading={sending}
                              disabled={bulkAction !== null ||
                                isSending(message.id) ||
                                message.editing}
                              onpointerdown={(event) => event.stopPropagation()}
                              onclick={() => handleSendNow(message.id)}
                              tooltip={m.chat_queuedMessages_sendNow_tooltip()}
                            >
                              <Fa icon={faArrowUp} class="w-3 h-3" />
                            </Button>
                          {/if}
                          {#if permissions(message).remove}
                            <Button
                              variant="ghost-light"
                              size="icon-xs"
                              iconOnly
                              class="-my-1"
                              aria-label={m.chat_queuedMessages_remove_tooltip()}
                              disabled={bulkAction !== null || isSending(message.id)}
                              onpointerdown={(event) => event.stopPropagation()}
                              onclick={() => handleRemove(message.id)}
                              tooltip={m.chat_queuedMessages_remove_tooltip()}
                            >
                              <XIcon size={13} weight="regular" aria-hidden="true" />
                            </Button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
                {#if sendErrors[message.id] || sendStates[message.id] === 'queued' || sendStates[message.id] === 'quarantined'}
                  <div
                    class="type-caption px-3 pb-1 text-warning-ink"
                    role={sendErrors[message.id] ? 'alert' : 'status'}
                  >
                    {sendErrors[message.id] ??
                      (sendStates[message.id] === 'quarantined'
                        ? m.chat_queuedMessages_quarantined_description()
                        : m.chat_queuedMessages_stillQueued_description())}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
          {#if clipped}
            <Button
              bind:ref={previewExpander}
              variant="plain"
              size="icon-compact"
              iconOnly
              class="absolute inset-x-0 bottom-0 h-10 w-full cursor-pointer items-end justify-center rounded-none border-0 bg-linear-to-b from-transparent to-background to-85% pb-1 text-muted-foreground"
              aria-label={m.chat_queuedMessages_expand_ariaLabel()}
              aria-expanded={false}
              aria-controls="{contentId}-viewport"
              onclick={expandPreview}
            />
          {:else if showAll}
            <Button
              variant="ghost-light"
              size="compact"
              class="type-caption w-full rounded-none"
              aria-expanded={true}
              aria-controls="{contentId}-viewport"
              data-testid="queued-messages-show-less"
              onclick={collapsePreview}
            >
              {m.chat_queuedMessages_showLess_label()}
            </Button>
          {/if}
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

<style>
  .queued-messages-surface {
    container: queued-messages / inline-size;
  }

  .queued-messages-body {
    --queued-messages-viewport-limit: max(
      48px,
      calc(var(--queued-messages-max-height, 50vh) - 38px)
    );
    max-height: var(--queued-messages-viewport-limit);
  }

  .queued-messages-viewport {
    max-height: var(--queued-messages-viewport-limit);
  }

  .queued-messages-preview {
    max-height: min(144px, var(--queued-messages-viewport-limit));
  }

  @container queued-messages (max-width: 280px) {
    .queued-message-actions {
      position: absolute;
      top: 0.25rem;
      right: 0.375rem;
      border-radius: var(--radius-medium);
      background: hsl(var(--background));
    }
  }
</style>
