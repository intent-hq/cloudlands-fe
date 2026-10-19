<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { EmptyState, ErrorState } from '$lib/components/patterns/screen';
  import { m } from '$shared/paraglide/messages.js';
  import { formatDaySeparator, formatInteger } from '$lib/i18n/format';
  import Fa from 'svelte-fa';
  import { faArrowUp, faArrowDown, faXmark, faReply } from '@fortawesome/free-solid-svg-icons';
  import CloudSlashIcon from 'phosphor-svelte/lib/CloudSlashIcon';
  import DiscussionMessageView from './DiscussionMessageView.svelte';
  import DiscussionSkeleton from './DiscussionSkeleton.svelte';
  import DiscussionMicrophone from './DiscussionMicrophone.svelte';
  import DiscussionReferencePicker from './DiscussionReferencePicker.svelte';
  import type { DiscussionPendingDisplay, DiscussionReactionDisplay } from './discussion-display';
  import {
    DISCUSSION_MAX_BODY_BYTES,
    type DiscussionMessage,
    type DiscussionAuthor,
  } from '$shared/types/workspace-discussion';

  interface Props {
    workspaceId?: string;
    conversationId?: string;
    sourcePanelId?: string;
    header?: Snippet;
    composerActions?: Snippet;
    composerContext?: Snippet;
    messageReferences?: Snippet<[DiscussionMessage]>;
    pendingMessages?: readonly DiscussionPendingDisplay[];
    typingAuthors?: readonly DiscussionAuthor[];
    reactionsByMessage?: Readonly<Record<string, readonly DiscussionReactionDisplay[]>>;
    unreadAfterSequence?: number | null;
    firstUnreadSequence?: number | null;
    unreadCount?: number;
    replyTo?: DiscussionMessage | null;
    onCancelReply?: () => void;
    sharingOff?: boolean;
    canEnableSharing?: boolean;
    onEnableSharing?: () => void;
    interactionError?: string | null;
    onReadThrough?: (sequence: number) => void;
    onReply?: (message: DiscussionMessage) => void;
    onReaction?: (messageId: string, emoji: string) => void;
    onCopyMessage?: (message: DiscussionMessage) => void;
    messages: readonly DiscussionMessage[];
    draft: string;
    typingLabel?: string | null;
    onComposerFocusChange?: (focused: boolean) => void;
    onTypingInput?: (typing: boolean) => void;
    initialized?: boolean;
    loading?: boolean;
    loadingOlder?: boolean;
    hasMore?: boolean;
    error?: string | null;
    sendError?: string | null;
    retryDraft?: boolean;
    sending?: boolean;
    failedMessages?: readonly { id: string; body: string; error: string }[];
    onRetryMessage?: (id: string) => void;
    canSend?: boolean;
    canSendDraft?: boolean;
    canCompose?: boolean;
    focusComposer?: boolean;
    showEmptyState?: boolean;
    emptyDescription?: string;
    composerPlaceholder?: string;
    isActive?: boolean;
    isPanelFocused?: boolean;
    onDraftChange: (value: string) => void;
    onSend: () => void;
    onLoadOlder: () => void;
    onRetry: () => void;
  }

  let {
    workspaceId,
    conversationId = 'default',
    sourcePanelId,
    header,
    composerActions,
    composerContext,
    messageReferences,
    pendingMessages = [],
    typingAuthors = [],
    reactionsByMessage = {},
    unreadAfterSequence = null,
    firstUnreadSequence = null,
    unreadCount = 0,
    replyTo = null,
    onCancelReply,
    sharingOff = false,
    canEnableSharing = false,
    onEnableSharing,
    interactionError = null,
    onReadThrough,
    onReply,
    onReaction,
    onCopyMessage,
    messages,
    draft,
    typingLabel = null,
    onComposerFocusChange,
    onTypingInput,
    initialized = true,
    loading = false,
    loadingOlder = false,
    hasMore = false,
    error = null,
    sendError = null,
    retryDraft = true,
    sending = false,
    failedMessages = [],
    onRetryMessage,
    canSend = true,
    canSendDraft = true,
    canCompose,
    focusComposer = true,
    showEmptyState = true,
    emptyDescription,
    composerPlaceholder,
    isActive = true,
    isPanelFocused = false,
    onDraftChange,
    onSend,
    onLoadOlder,
    onRetry,
  }: Props = $props();
  let scroller: HTMLDivElement | undefined = $state();
  let composer: HTMLTextAreaElement | null = $state(null);
  const tooLong = $derived(new TextEncoder().encode(draft).byteLength > DISCUSSION_MAX_BODY_BYTES);
  let composing = false;
  let lastReportedSequence = 0;
  const firstUnreadId = $derived(
    unreadCount <= 0
      ? undefined
      : firstUnreadSequence !== null
        ? messages.find((message) => message.sequence === firstUnreadSequence)?.id
        : unreadAfterSequence === null
          ? undefined
          : messages.find((message) => message.sequence > unreadAfterSequence)?.id,
  );
  function dayKey(value: string) {
    return new Date(value).toDateString();
  }
  function isContinuation(index: number) {
    const previous = messages[index - 1],
      current = messages[index];
    return (
      !!previous &&
      current.id !== firstUnreadId &&
      previous.author.principalId === current.author.principalId &&
      dayKey(previous.createdAt) === dayKey(current.createdAt) &&
      Date.parse(current.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000
    );
  }
  function reportVisible() {
    const element = scroller;
    if (!element) return;
    if (
      !isActive ||
      !isPanelFocused ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus() ||
      !onReadThrough
    )
      return;
    const bottom = element.getBoundingClientRect().bottom;
    const top = element.getBoundingClientRect().top;
    const visible = messages.filter((message) => {
      const row = element.querySelector<HTMLElement>(
        `[data-discussion-message="${CSS.escape(message.id)}"]`,
      );
      return (
        row &&
        row.getBoundingClientRect().bottom <= bottom + 1 &&
        row.getBoundingClientRect().bottom > top
      );
    });
    const sequence = visible.at(-1)?.sequence;
    if (sequence !== undefined && sequence > lastReportedSequence) {
      lastReportedSequence = sequence;
      onReadThrough(sequence);
    }
  }
  function jumpToNewest() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    reportVisible();
  }
  $effect(() => {
    void isActive;
    void isPanelFocused;
    void messages.length;
    void tick().then(reportVisible);
  });
  let firstRender = true;
  let previousFirstId: string | undefined;
  let previousLastId: string | undefined;

  // Preserve the visible message when history is prepended or the loading row changes.
  // Live arrivals follow the bottom only while the reader is already there.
  $effect.pre(() => {
    const firstId = messages[0]?.id;
    const lastId = pendingMessages.at(-1)?.id ?? messages.at(-1)?.id;
    void typingAuthors.length;
    void loadingOlder;
    void hasMore;
    void error;
    const element = scroller;
    const active = isActive;
    if (!element || !active) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    const initial = firstRender;
    const changed = firstId !== previousFirstId || lastId !== previousLastId;
    const prepended =
      !!previousFirstId &&
      firstId !== previousFirstId &&
      messages.some((message) => message.id === previousFirstId);
    const top = element.getBoundingClientRect().top;
    const anchor = Array.from(
      element.querySelectorAll<HTMLElement>('[data-discussion-message]'),
    ).find((row) => row.getBoundingClientRect().bottom > top);
    const offset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    const priorScroll = element.scrollTop;
    previousFirstId = firstId;
    previousLastId = lastId;
    if (messages.length > 0) firstRender = false;
    void tick().then(() => {
      if (!element.isConnected) return;
      if (initial && firstUnreadId && unreadCount > 0) {
        const divider = element.querySelector<HTMLElement>('[data-discussion-unread]');
        if (divider)
          element.scrollTop +=
            divider.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            element.clientHeight / 2;
      } else if ((initial || (atBottom && !prepended)) && changed) {
        element.scrollTop = element.scrollHeight;
      } else if (anchor?.isConnected) {
        element.scrollTop =
          priorScroll +
          anchor.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          offset;
      }
      reportVisible();
    });
  });

  $effect(() => {
    if (focusComposer && isActive && isPanelFocused && composer) {
      untrack(() => composer?.focus({ preventScroll: true }));
    }
  });

  // Report DOM focus loss on panel deactivation, access loss, and unmount.
  $effect(() => {
    if (!isActive || !isPanelFocused || !canSend) untrack(() => onComposerFocusChange?.(false));
    return () => untrack(() => onComposerFocusChange?.(false));
  });

  function input(event: Event & { currentTarget: HTMLTextAreaElement }) {
    onDraftChange(event.currentTarget.value);
    if (isActive && isPanelFocused && canSend && document.activeElement === composer) {
      onComposerFocusChange?.(true);
      onTypingInput?.(!!event.currentTarget.value.trim());
    }
  }

  function appendToDraft(text: string) {
    const current = composer?.value ?? draft;
    onDraftChange(current + (current && !/\s$/.test(current) ? ' ' : '') + text);
    void tick().then(() => composer?.focus({ preventScroll: true }));
  }

  function send() {
    const body = composer?.value ?? draft;
    if (
      !canSend ||
      !canSendDraft ||
      sending ||
      composing ||
      new TextEncoder().encode(body).byteLength > DISCUSSION_MAX_BODY_BYTES ||
      !body.trim()
    )
      return;
    onTypingInput?.(false);
    onSend();
    composer?.focus({ preventScroll: true });
  }

  function loadOlder() {
    scroller?.focus({ preventScroll: true });
    onLoadOlder();
  }

  function onKeydown(event: KeyboardEvent) {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.isComposing ||
      composing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    send();
  }
</script>

<svelte:document onvisibilitychange={reportVisible} />
<svelte:window onfocus={reportVisible} />
<div class="relative flex h-full min-h-0 min-w-0 flex-col bg-background" data-workspace-discussion>
  {#if header}{@render header()}{/if}
  {#if sharingOff}
    <div
      class="flex shrink-0 items-center gap-2.5 bg-sidebar py-2 pl-4 pr-3 type-caption"
      data-discussion-sharing-off
    >
      <CloudSlashIcon size={16} /><span class="min-w-0 flex-1"
        >{m.workspace_discussion_sharingOff_label()}</span
      >
      {#if canEnableSharing}<Button
          variant="outline"
          size="compact"
          class="bg-background"
          onclick={onEnableSharing}>{m.workspace_discussion_turnOn_label()}</Button
        >{/if}
    </div>
  {/if}
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div
      bind:this={scroller}
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
      data-discussion-scroll
      tabindex="-1"
      role="region"
      aria-label={m.workspace_discussion_title()}
      onscroll={reportVisible}
    >
      <div
        class="flex min-h-full flex-col gap-[18px]"
        class:justify-end={initialized && !hasMore && !error && unreadCount === 0}
      >
        {#if hasMore || loadingOlder}
          <div class="flex justify-center">
            <Button variant="ghost" size="sm" loading={loadingOlder} onclick={loadOlder}
              >{m.workspace_discussion_loadOlder_label()}</Button
            >
          </div>
        {/if}
        {#if error}
          <ErrorState density="compact" {onRetry} retryLabel={m.ui_errorToast_retry_label()}
            >{#snippet message()}{error}{/snippet}</ErrorState
          >
        {:else if !initialized && loading}
          <DiscussionSkeleton />
        {:else if showEmptyState && initialized && messages.length === 0 && pendingMessages.length === 0}
          <EmptyState density="compact"
            >{#snippet title()}{m.workspace_discussion_empty_title()}{/snippet}{#snippet description()}{emptyDescription ??
                m.workspace_discussion_empty_description()}{/snippet}</EmptyState
          >
        {/if}
        <div
          class="flex flex-col gap-[18px]"
          role="log"
          aria-label={m.workspace_discussion_title()}
          aria-relevant="additions text"
        >
          {#each messages as message, index (message.id)}
            {#if index === 0 ? dayKey(message.createdAt) !== new Date().toDateString() : dayKey(messages[index - 1].createdAt) !== dayKey(message.createdAt)}
              <div
                class="flex items-center gap-2.5 type-caption text-muted-foreground"
                data-discussion-day
              >
                <span class="h-px flex-1 bg-border"></span><span
                  >{formatDaySeparator(message.createdAt)}</span
                ><span class="h-px flex-1 bg-border"></span>
              </div>
            {/if}
            {#if message.id === firstUnreadId}
              <div
                class="flex items-center gap-2.5 type-caption text-danger"
                data-discussion-unread
              >
                <span class="h-px flex-1 bg-danger"></span><span
                  >{m.workspace_discussion_new_label()}</span
                ><span class="h-px flex-1 bg-danger"></span>
              </div>
            {/if}
            <DiscussionMessageView
              {workspaceId}
              {sourcePanelId}
              {message}
              continuation={isContinuation(index)}
              reactions={reactionsByMessage[message.id]}
              disabled={!canSend}
              onReply={onReply
                ? () => {
                    onReply?.(message);
                    composer?.focus({ preventScroll: true });
                  }
                : undefined}
              onReaction={onReaction ? (emoji) => onReaction?.(message.id, emoji) : undefined}
              onCopy={onCopyMessage ? () => onCopyMessage?.(message) : undefined}
            >
              {#snippet references()}{#if messageReferences}{@render messageReferences(
                    message,
                  )}{/if}{/snippet}
            </DiscussionMessageView>
          {/each}
          {#each pendingMessages as message (message.id)}
            <DiscussionMessageView
              {workspaceId}
              {sourcePanelId}
              {message}
              status={message.status}
              error={message.error}
              disabled={!canSend || sending}
              onRetry={() => onRetryMessage?.(message.id)}
            />
          {/each}
          {#if !pendingMessages.length}
            {#each failedMessages as message (message.id)}
              <div
                class="min-w-0 rounded-lg border border-danger bg-muted/30 p-3 dark:bg-muted"
                data-discussion-failed={message.id}
              >
                <p class="whitespace-pre-wrap type-caption [overflow-wrap:anywhere]">
                  {message.body}
                </p>
                <p class="mt-2 type-caption text-muted-foreground" role="alert">{message.error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canSend || sending}
                  onclick={() => onRetryMessage?.(message.id)}
                  >{m.ui_errorToast_retry_label()}</Button
                >
              </div>
            {/each}
          {/if}
        </div>
        {#if typingLabel || typingAuthors.length}
          <div role="status" aria-live="polite" aria-atomic="true" data-discussion-typing>
            <div class="flex items-center gap-3">
              <div class="flex -space-x-3">
                {#each typingAuthors.slice(0, 3) as author (author.principalId)}<PrincipalAvatar
                    label={author.displayName ||
                      author.login ||
                      m.workspace_discussion_unknownAuthor_label()}
                    avatarUrl={author.avatarUrl}
                    size={32}
                  />{/each}
              </div>
              <div
                class="flex h-[30px] w-[50px] items-center justify-center gap-1 rounded-lg bg-muted/60"
                aria-hidden="true"
              >
                <span class="size-1.5 rounded-full bg-muted-foreground"></span><span
                  class="size-1.5 rounded-full bg-muted-foreground/60"
                ></span><span class="size-1.5 rounded-full bg-muted-foreground/40"></span>
              </div>
              <span class="sr-only">{typingLabel}</span>
            </div>
          </div>
        {/if}
      </div>
    </div>
    {#if unreadCount > 0}
      <div class="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <Button
          variant="plain"
          class="pointer-events-auto h-8 gap-1.5 rounded-full bg-foreground px-3 text-background shadow-md"
          onclick={jumpToNewest}
          aria-label={m.workspace_discussion_jumpNew_label({ count: formatInteger(unreadCount) })}
          ><Fa icon={faArrowDown} />{m.workspace_discussion_jumpNew_label({
            count: formatInteger(unreadCount),
          })}</Button
        >
      </div>
    {/if}
  </div>
  <div class="shrink-0 px-3 pb-3 pt-2" data-discussion-composer>
    {#if interactionError}<p class="mb-2 type-caption text-danger" role="alert">
        {interactionError}
      </p>{/if}
    {#if sendError || tooLong}<p class="mb-2 type-caption text-danger" role="alert">
        {tooLong ? m.workspace_discussion_tooLong_error() : sendError}
      </p>{/if}
    {#if composerContext}{@render composerContext()}{/if}
    {#if replyTo}
      <div
        class="mb-2 flex min-w-0 items-start gap-2 rounded-lg border border-border px-3 py-2 type-caption"
        data-discussion-reply-preview
      >
        <Fa icon={faReply} />
        <div class="min-w-0 flex-1">
          <p class="text-muted-foreground">
            {m.workspace_discussion_replyingTo_label({
              name:
                replyTo.author.displayName ||
                replyTo.author.login ||
                m.workspace_discussion_unknownAuthor_label(),
            })}
          </p>
          <p class="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{replyTo.body}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={m.workspace_discussion_cancelReply_label()}
          onclick={onCancelReply}><Fa icon={faXmark} /></Button
        >
      </div>
    {/if}
    <div
      class="flex min-h-[76px] flex-col justify-end rounded-(--radius-large) border border-border bg-surface-2 px-3 py-2.5 shadow-none"
      class:opacity-45={!(canCompose ?? canSend)}
    >
      <div class="flex items-end gap-3">
        <Textarea
          bind:ref={composer}
          value={draft}
          aria-label={m.workspace_discussion_composer_label()}
          placeholder={composerPlaceholder ?? m.workspace_discussion_composer_placeholder()}
          class="min-h-6 flex-1 resize-none rounded-none border-0 bg-transparent p-0 py-0.5 type-caption leading-5 shadow-none hover:bg-transparent"
          rows={1}
          autoResize
          noFocusStyle
          minHeight={24}
          maxHeight={160}
          readonly={!(canCompose ?? canSend)}
          aria-invalid={tooLong || undefined}
          oninput={input}
          onfocus={() => onComposerFocusChange?.(isActive && isPanelFocused && canSend)}
          onblur={() => onComposerFocusChange?.(false)}
          onkeydown={onKeydown}
          oncompositionstart={() => {
            composing = true;
          }}
          oncompositionend={() => {
            composing = false;
          }}
        />
        <div class="flex shrink-0 items-center gap-3">
          {#if composerActions}{@render composerActions()}{:else if workspaceId}
            <DiscussionReferencePicker
              {workspaceId}
              disabled={!(canCompose ?? canSend)}
              onSelect={appendToDraft}
            />
            <DiscussionMicrophone
              {workspaceId}
              {conversationId}
              active={isActive && isPanelFocused}
              disabled={!(canCompose ?? canSend)}
              onTranscript={appendToDraft}
            />
          {/if}<Button
            variant="primary"
            size="icon-compact"
            class="size-6 rounded-md"
            disabled={!canSend || !canSendDraft || !draft.trim() || sending || tooLong}
            aria-label={sendError && retryDraft
              ? m.ui_errorToast_retry_label()
              : m.workspace_discussion_send_label()}
            onclick={send}><Fa icon={faArrowUp} /></Button
          >
        </div>
      </div>
    </div>
  </div>
</div>
