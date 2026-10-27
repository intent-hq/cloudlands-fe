<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { Workspace, QueuedMessage } from '$shared/types';
  import type { PendingQueueDisplayRow } from '$store/renderer/slices/pending-submissions/pending-submissions-projection';
  import type {
    DockConversationAgent,
    DockConversationMessage,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-types';

  export interface DockConversationPanelProps {
    conversationKey: string;
    composer?: Snippet;
    agentId: string | null;
    agents: DockConversationAgent[];
    workspaceTitle: string;
    workspace?: Workspace | null;
    ownPrincipalId?: string | null;
    pendingMessages?: DockConversationMessage[];
    queuedMessages?: QueuedMessage[];
    queueRows?: PendingQueueDisplayRow[];
    messages: DockConversationMessage[];
    draft: string;
    loading?: boolean;
    running?: boolean;
    error?: string | null;
    sending?: boolean;
    sendError?: string | null;
    canRetry?: boolean;
    blocked?: boolean;
    draftDisabled?: boolean;
    attention?: string | null;
    onDraftChange: (value: string) => void;
    onSend: () => void;
    onSelectAgent: (id: string) => void;
    onBack: () => void;
    onOpenWorkspace: () => void;
    onRetryLoad: () => void;
    onRetrySend: () => void;
  }
</script>

<script lang="ts">
  import { tick, untrack, type ComponentProps } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faArrowUpRightFromSquare,
    faChevronDown,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Select } from '$lib/components/ui/select';
  import { MessageComposer } from '$lib/components/ui/message-composer';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { ScreenHeader, EmptyState, LoadingState } from '$lib/components/patterns/screen';
  import ScrollToBottomButton from '$lib/components/chat/ScrollToBottomButton.svelte';
  import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';
  import { isEventWakeMessage } from '$lib/components/chat/event-wake-summary';
  import QueuedMessageList from '$lib/components/chat/QueuedMessageList.svelte';
  import { provideOperationalPanel } from '$lib/components/chat/operational-panel.svelte';
  import { extractAllContent } from '$shared/types';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let {
    conversationKey,
    composer,
    agentId,
    agents,
    workspaceTitle,
    workspace = null,
    ownPrincipalId = null,
    pendingMessages = [],
    queuedMessages = [],
    queueRows,
    messages,
    draft,
    loading = false,
    running = false,
    error = null,
    sending = false,
    sendError = null,
    canRetry = true,
    blocked = false,
    draftDisabled = blocked,
    attention = null,
    onDraftChange,
    onSend,
    onSelectAgent,
    onBack,
    onOpenWorkspace,
    onRetryLoad,
    onRetrySend,
  }: DockConversationPanelProps = $props();

  const uid = $props.id();
  const agent = $derived(agents.find((item) => item.id === agentId));
  const agentName = $derived(agent?.name ?? m.chat_shared_agentName_fallback());
  let scrollArea: HTMLDivElement | undefined = $state();
  let transcript: HTMLDivElement | undefined = $state();
  let following = $state(true);
  let lastScrollTop = 0;
  let newActivity = $state(false);
  provideOperationalPanel(() => scrollArea);
  const transcriptEmpty = $derived(
    messages.length === 0 &&
      pendingMessages.length === 0 &&
      queuedMessages.length === 0 &&
      !queueRows?.length,
  );
  const choices = $derived(agents.map((item) => ({ value: item.id, label: item.name })));
  const canSend = $derived(
    !blocked && !sending && !loading && !!agentId && draft.trim().length > 0,
  );
  const sendLabel = $derived(
    sending ? m.chat_queuedMessages_sending_label() : m.chat_agentInputArea_sendMessage_label(),
  );

  function jumpToLatest(): void {
    if (!scrollArea) return;
    scrollArea.scrollTop = scrollArea.scrollHeight;
    lastScrollTop = scrollArea.scrollTop;
    following = true;
    newActivity = false;
  }

  function trackScroll(): void {
    if (!scrollArea) return;
    const top = scrollArea.scrollTop;
    const atBottom = scrollArea.scrollHeight - scrollArea.clientHeight - top < 24;
    // Markdown can grow between our bottom jump and its queued scroll event.
    // Distance alone would misread that layout growth as the reader leaving.
    if (atBottom) following = true;
    else if (top < lastScrollTop - 1) following = false;
    lastScrollTop = top;
    if (following) newActivity = false;
  }

  // Reading position belongs to this view; draft ownership remains with the parent.
  $effect(() => {
    void conversationKey;
    following = true;
    newActivity = false;
    let active = true;
    void tick().then(() => {
      if (active) jumpToLatest();
    });
    return () => {
      active = false;
    };
  });

  $effect(() => {
    // Preserve streaming and attachment-only activity without flattening message data.
    const revision = [...messages, ...pendingMessages].map((message) => ({
      id: message.id,
      text: extractAllContent(message),
      blocks: message.contentBlocks,
      tools: message.toolCalls,
      results: message.toolResults,
    }));
    void revision;
    void queuedMessages;
    void queueRows;
    const shouldFollow = untrack(() => following);
    let active = true;
    void tick().then(() => {
      if (!active) return;
      if (shouldFollow && untrack(() => following)) jumpToLatest();
      else newActivity = true;
    });
    return () => {
      active = false;
    };
  });

  $effect(() => {
    const area = scrollArea;
    const content = transcript;
    if (!area || !content) return;
    const observer = new ResizeObserver(() => {
      // A growing composer or streaming message must not pull a reader down.
      if (untrack(() => following)) jumpToLatest();
    });
    observer.observe(area);
    observer.observe(content);
    return () => observer.disconnect();
  });

  function submit(): void {
    if (canSend) onSend();
  }
</script>

<section
  class="dock-conversation"
  aria-label={m.dock_conversation_transcript_label()}
  data-dock-conversation
>
  <ScreenHeader class="items-center gap-2 px-3 py-2 border-b border-border">
    {#snippet leading()}
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={onBack}
          data-dock-conversation-back
          aria-label={m.ui_contentHeader_goBack_tooltip()}
          title={m.ui_contentHeader_goBack_tooltip()}><Fa icon={faArrowLeft} /></Button
        >
        <AgentAvatar agentId={agentId ?? ''} variant="standard" class="shrink-0" />
      </div>
    {/snippet}
    {#snippet title()}
      {#if agents.length > 1}
        <Select.Root value={agentId ?? ''} items={choices} onchange={onSelectAgent}>
          <Select.Trigger
            variant="ghost"
            class="w-full min-w-0 justify-start"
            aria-label={m.dock_conversation_agent_ariaLabel()}
          >
            <span class="truncate">{agentName}</span><Fa
              icon={faChevronDown}
              class="size-2.5 shrink-0 text-muted-foreground"
            />
          </Select.Trigger>
          <Select.Content portal={false} class="max-h-48">
            {#each agents as option (option.id)}
              <Select.Item value={option.id} label={option.name}>{option.name}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {:else}
        <h2 class="type-body font-medium truncate" title={agentName}>{agentName}</h2>
      {/if}
    {/snippet}
    {#snippet description()}
      <p class="type-caption truncate" title={workspaceTitle}>{workspaceTitle}</p>
    {/snippet}
    {#snippet actions()}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={onOpenWorkspace}
        aria-label={m.dock_conversation_openFull_ariaLabel()}
        title={m.dock_conversation_openFull_ariaLabel()}
        ><Fa icon={faArrowUpRightFromSquare} /></Button
      >
    {/snippet}
  </ScreenHeader>

  <div class="conversation-body">
    <div
      bind:this={scrollArea}
      class="transcript-scroll"
      onscroll={trackScroll}
      role="region"
      aria-label={m.dock_conversation_messages_ariaLabel()}
      aria-busy={loading}
      tabindex="0"
    >
      <div bind:this={transcript} class="transcript">
        {#if loading && transcriptEmpty}
          <LoadingState
            density="compact"
            count={3}
            label={m.chat_agentThread_loading_label()}
            class="py-6"
          />
        {:else if !error && transcriptEmpty}
          <EmptyState density="compact">
            {#snippet title()}{m.dock_conversation_empty_label()}{/snippet}
            {#snippet description()}{m.dock_conversation_empty_description()}{/snippet}
          </EmptyState>
        {/if}
        {#each messages as message, index (message.id)}
          <div class="canonical-message">
            {#if message.role === 'user' && isEventWakeMessage(message)}
              <EventWakeupBanner
                metadata={message.metadata as ComponentProps<typeof EventWakeupBanner>['metadata']}
                messageText={extractAllContent(message)}
                asDivider
                compact
                suppressTopGap
                {workspace}
              />
            {:else}
              <ChatMessage
                {message}
                agentId={agentId ?? undefined}
                {workspace}
                {ownPrincipalId}
                isStreaming={message.isStreaming ?? false}
                isLastConversationMessage={index === messages.length - 1}
              />
            {/if}
          </div>
        {/each}
        {#each pendingMessages as message (message.id)}
          <div class="canonical-message">
            <ChatMessage
              {message}
              agentId={agentId ?? undefined}
              {workspace}
              {ownPrincipalId}
              ownsMessageIdentity={false}
            />
          </div>
        {/each}
        {#if queuedMessages.length || queueRows?.length}
          <div class="conversation-queue">
            <QueuedMessageList
              messages={queuedMessages}
              displayRows={queueRows}
              agentId={agentId ?? undefined}
              workspaceId={workspace?.id}
              ownerPrincipalId={workspace?.ownerPrincipalId}
              presentationPrincipalId={ownPrincipalId}
              disabled
            />
          </div>
        {/if}
        {#if error}
          <EmptyState density="compact" severity="danger" role="alert">
            {#snippet description()}<span class="text-danger break-words">{error}</span>{/snippet}
            {#snippet actions()}
              <Button variant="outline" size="sm" onclick={onRetryLoad} disabled={loading}
                >{m.chat_shared_retry_label()}</Button
              >
            {/snippet}
          </EmptyState>
        {/if}
      </div>
    </div>
    {#if newActivity}
      <div class="new-activity">
        <ScrollToBottomButton onclick={jumpToLatest} floating />
      </div>
    {/if}
  </div>

  <footer class="conversation-footer">
    {#if running || sending}<div class="conversation-status" role="status" aria-live="polite">
        {#if running}<span class="running-dot" aria-hidden="true"
          ></span>{m.dock_conversation_running_label()}{:else if sending}{m.chat_queuedMessages_sending_label()}{/if}
      </div>{/if}
    {#if sendError}
      <div class="send-recovery">
        <InputMessage
          id={`${uid}-send-error`}
          tone="error"
          class="m-0 max-h-18 overflow-auto min-w-0 flex-1 break-words">{sendError}</InputMessage
        >
        {#if canRetry}
          <Button variant="outline" size="sm" onclick={onRetrySend} disabled={sending || loading}>
            {m.chat_shared_retry_label()}
          </Button>
        {/if}
      </div>
    {/if}
    {#if attention}<div class="attention">
        <InputMessage id={`${uid}-attention`}>{attention}</InputMessage>
        <Button variant="outline" size="sm" onclick={onOpenWorkspace}
          >{m.dock_conversation_openFull_ariaLabel()}</Button
        >
      </div>{/if}
    {#if composer}
      {@render composer()}
    {:else}
      <MessageComposer
        value={draft}
        onValueChange={onDraftChange}
        onSend={submit}
        disabled={draftDisabled || loading || !agentId}
        sendDisabled={!canSend}
        placeholder={m.dock_conversation_reply_placeholder({ name: agentName })}
        {sendLabel}
        minRows={1}
        maxRows={5}
        textareaProps={{
          'data-dock-conversation-composer': '',
          'aria-label': m.chat_richInput_editor_ariaLabel(),
          'aria-describedby': sendError
            ? `${uid}-send-error`
            : attention
              ? `${uid}-attention`
              : undefined,
        }}
      />
    {/if}
  </footer>
</section>

<style>
  .dock-conversation {
    isolation: isolate;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius-large);
    background: hsl(var(--popover));
    color: hsl(var(--foreground));
  }
  .conversation-body {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .transcript-scroll {
    height: 100%;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    overflow-anchor: none;
  }
  .transcript {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  .canonical-message {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .conversation-queue {
    min-width: 0;
    --queued-messages-max-height: 160px;
  }
  .new-activity {
    position: absolute;
    bottom: var(--space-3);
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .new-activity :global(button) {
    pointer-events: auto;
  }
  .conversation-footer {
    flex: none;
    padding: 0 var(--space-3) var(--space-3);
  }
  .conversation-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 28px;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
  }
  .running-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .attention {
    max-height: 72px;
    overflow: auto;
    margin: 0 0 var(--space-2);
    font-size: var(--text-caption-size);
    overflow-wrap: anywhere;
  }
  .send-recovery {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .attention {
    color: hsl(var(--muted-foreground));
  }
  .attention :global(button) {
    margin-top: var(--space-2);
  }
</style>
