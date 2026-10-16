<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { EmptyState, ErrorState, LoadingState } from '$lib/components/patterns/screen';
  import { m } from '$shared/paraglide/messages.js';
  import { formatFullDateTime, formatTime } from '$lib/i18n/format';
  import {
    DISCUSSION_MAX_BODY_BYTES,
    type DiscussionMessage,
  } from '$shared/types/workspace-discussion';

  interface Props {
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
    sending?: boolean;
    failedMessages?: readonly { id: string; body: string; error: string }[];
    onRetryMessage?: (id: string) => void;
    canSend?: boolean;
    isActive?: boolean;
    isPanelFocused?: boolean;
    onDraftChange: (value: string) => void;
    onSend: () => void;
    onLoadOlder: () => void;
    onRetry: () => void;
  }

  let {
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
    sending = false,
    failedMessages = [],
    onRetryMessage,
    canSend = true,
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
  let firstRender = true;
  let previousFirstId: string | undefined;
  let previousLastId: string | undefined;

  // Preserve the visible message when history is prepended or the loading row changes.
  // Live arrivals follow the bottom only while the reader is already there.
  $effect.pre(() => {
    const firstId = messages[0]?.id;
    const lastId = messages.at(-1)?.id;
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
      if ((initial || (atBottom && !prepended)) && changed) {
        element.scrollTop = element.scrollHeight;
      } else if (anchor?.isConnected) {
        element.scrollTop =
          priorScroll +
          anchor.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          offset;
      }
    });
  });

  $effect(() => {
    if (isActive && isPanelFocused && composer) {
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

  function send() {
    const body = composer?.value ?? draft;
    if (
      !canSend ||
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

  function authorName(message: DiscussionMessage) {
    return (
      message.author.displayName ||
      message.author.login ||
      m.workspace_discussion_unknownAuthor_label()
    );
  }
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col bg-background" data-workspace-discussion>
  <div
    bind:this={scroller}
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
    data-discussion-scroll
    tabindex="-1"
    role="region"
    aria-label={m.workspace_discussion_title()}
  >
    {#if hasMore || loadingOlder}
      <div class="mb-4 flex justify-center">
        <Button variant="ghost" size="sm" loading={loadingOlder} onclick={loadOlder}>
          {m.workspace_discussion_loadOlder_label()}
        </Button>
      </div>
    {/if}
    {#if error}
      <ErrorState density="compact" {onRetry} retryLabel={m.ui_errorToast_retry_label()}>
        {#snippet message()}{error}{/snippet}
      </ErrorState>
    {:else if !initialized && loading}
      <LoadingState label={m.workspace_discussion_loading_label()} count={3} />
    {:else if initialized && messages.length === 0}
      <EmptyState density="compact">
        {#snippet title()}{m.workspace_discussion_empty_title()}{/snippet}
        {#snippet description()}{m.workspace_discussion_empty_description()}{/snippet}
      </EmptyState>
    {/if}
    <div
      class="flex flex-col gap-5"
      role="log"
      aria-label={m.workspace_discussion_title()}
      aria-relevant="additions text"
    >
      {#each messages as message (message.id)}
        <article class="flex min-w-0 items-start gap-2.5" data-discussion-message={message.id}>
          <PrincipalAvatar
            label={authorName(message)}
            avatarUrl={message.author.avatarUrl}
            size={28}
          />
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex min-w-0 items-baseline gap-2 type-caption">
              <span class="min-w-0 truncate font-medium text-foreground">{authorName(message)}</span
              >
              <time
                class="shrink-0 text-muted-foreground"
                datetime={message.createdAt}
                title={formatFullDateTime(message.createdAt)}
              >
                {formatTime(message.createdAt)}
              </time>
            </div>
            <p
              class="m-0 w-fit max-w-full whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 type-caption leading-relaxed text-foreground [overflow-wrap:anywhere]"
            >
              {message.body}
            </p>
          </div>
        </article>
      {/each}
      {#each failedMessages as message (message.id)}
        <div class="min-w-0 rounded-lg bg-muted p-3" data-discussion-failed={message.id}>
          <p class="whitespace-pre-wrap type-caption [overflow-wrap:anywhere]">{message.body}</p>
          <p class="mt-2 type-caption text-muted-foreground" role="alert">{message.error}</p>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canSend || sending}
            onclick={() => onRetryMessage?.(message.id)}>{m.ui_errorToast_retry_label()}</Button
          >
        </div>
      {/each}
    </div>
  </div>
  <div class="shrink-0 px-4 pb-4 pt-2" data-discussion-composer>
    <div role="status" aria-live="polite" aria-atomic="true" data-discussion-typing>
      {#if typingLabel}<p class="mb-2 type-caption text-muted-foreground">{typingLabel}</p>{/if}
    </div>
    {#if sendError || tooLong}
      <p class="mb-2 type-caption text-muted-foreground" role="alert">
        {tooLong ? m.workspace_discussion_tooLong_error() : sendError}
      </p>
    {/if}
    <div
      class="overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring"
    >
      <Textarea
        bind:ref={composer}
        value={draft}
        aria-label={m.workspace_discussion_composer_label()}
        placeholder={m.workspace_discussion_composer_placeholder()}
        class="min-h-20 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        rows={3}
        readonly={!canSend}
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
      <div class="flex items-center justify-end gap-2 px-2 pb-2">
        <Button
          size="sm"
          disabled={!canSend || !draft.trim() || sending || tooLong}
          loading={sending}
          onclick={send}
        >
          {sendError ? m.ui_errorToast_retry_label() : m.workspace_discussion_send_label()}
        </Button>
      </div>
    </div>
  </div>
</div>
