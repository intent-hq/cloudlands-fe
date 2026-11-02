<script lang="ts" module>
  import type { Snippet, ComponentProps } from 'svelte';
  import type StreamingStatusComponent from '$lib/components/chat/StreamingStatus.svelte';
  import type { Workspace, QueuedMessage } from '$shared/types';
  import type { PendingQueueDisplayRow } from '$store/renderer/slices/pending-submissions/pending-submissions-projection';
  import type {
    DockConversationAgent,
    DockConversationMessage,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-types';

  export interface DockConversationPanelProps {
    conversationKey: string;
    composer?: Snippet;
    questions?: Snippet;
    /** False while the person has hidden the question card (it stays collapsed above the composer). */
    questionsExpanded?: boolean;
    mediaStatus?: { kind: 'annotating' | 'listening' | 'recording'; label: string };
    agentId: string | null;
    agents: DockConversationAgent[];
    workspaceTitle: string;
    workspace?: Workspace | null;
    /** The open conversation's workspace (the Assistant's is the chief workspace). */
    workspaceId?: string | null;
    ownPrincipalId?: string | null;
    pendingMessages?: DockConversationMessage[];
    queuedMessages?: QueuedMessage[];
    queueRows?: PendingQueueDisplayRow[];
    messages: DockConversationMessage[];
    draft: string;
    loading?: boolean;
    running?: boolean;
    streamingStatus?: ComponentProps<typeof StreamingStatusComponent>;
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
  import { tick, untrack } from 'svelte';
  import { fly } from '$lib/motion';
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
  import ChatContentLane from '$lib/components/chat/ChatContentLane.svelte';
  import QuestionComposer from '$lib/components/chat/questions/QuestionComposer.svelte';
  import DockConversationNotifications, {
    getDockConversationNoticeHost,
  } from './DockConversationNotifications.svelte';
  import ChatTurnNotice from '$lib/components/chat/ChatTurnNotice.svelte';
  import ConversationTurnGap from '$lib/components/chat/ConversationTurnGap.svelte';
  import StreamingStatus from '$lib/components/chat/StreamingStatus.svelte';
  import {
    groupIntoTurns,
    hasOperationalAssistantTurnBoundary,
  } from '$lib/components/chat/conversation-turns';
  import {
    getSubscriptionCardSeam,
    hasVisibleTurnBody,
    isChatCardMessage,
  } from '$lib/components/chat/subscription-card-spacing';
  import {
    isAttentionQuestionAnswerSeam,
    eventCardAssistantMarginClass,
  } from '$lib/components/chat/attention-flow-spacing';
  import { isBatchedDeliverySeam } from '$lib/utils/queue-info';
  import { isAutomatedChatMessage } from '$lib/utils/previous-user-message';
  import { CHAT_TRANSCRIPT_OVERFLOW_CLASS } from '$lib/components/chat/chat-queue-edge-layout';
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';
  import { isEventWakeMessage } from '$lib/components/chat/event-wake-summary';
  import QueuedMessageList from '$lib/components/chat/QueuedMessageList.svelte';
  import { provideOperationalPanel } from '$lib/components/chat/operational-panel.svelte';
  import { extractAllContent } from '$shared/types';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DockWorkspaceAvatar from './DockWorkspaceAvatar.svelte';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { m } from '$shared/paraglide/messages.js';

  let {
    conversationKey,
    composer,
    questions,
    questionsExpanded = !!questions,
    mediaStatus,
    agentId,
    agents,
    workspaceTitle,
    workspace = null,
    workspaceId = null,
    ownPrincipalId = null,
    pendingMessages = [],
    queuedMessages = [],
    queueRows,
    messages,
    draft,
    loading = false,
    running = false,
    streamingStatus = {},
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
  const notices = getDockConversationNoticeHost();
  let bodyHeight = $state(0);
  let footerHeight = $state(0);
  // The question may cover everything below the header, less the composer lane's
  // block padding (0.5rem + 1rem) and a little transcript left visible above it.
  const QUESTION_RESERVE_PX = 32;
  const questionMaxHeight = $derived(
    bodyHeight + footerHeight > 0
      ? Math.max(0, bodyHeight + footerHeight - QUESTION_RESERVE_PX)
      : undefined,
  );
  const agent = $derived(agents.find((item) => item.id === agentId));
  const agentName = $derived(agent?.name ?? m.chat_shared_agentName_fallback());
  const isAssistant = $derived(
    (workspaceId ?? (workspace ? String(workspace.id) : null)) === CHIEF_WORKSPACE_ID,
  );
  let scrollArea: HTMLDivElement | undefined = $state();
  let transcript: HTMLDivElement | undefined = $state();
  let following = $state(true);
  let lastScrollTop = 0;
  let newActivity = $state(false);
  const operationalPanel = provideOperationalPanel(() => scrollArea);
  // The dock shell reveals and morphs with transforms and clip-path, which fire no
  // scroll or resize. Re-measure visible transcript rows once each motion settles.
  $effect(() => {
    const refresh = () => operationalPanel.refreshGeometry();
    window.addEventListener('transitionend', refresh, true);
    window.addEventListener('animationend', refresh, true);
    return () => {
      window.removeEventListener('transitionend', refresh, true);
      window.removeEventListener('animationend', refresh, true);
    };
  });
  const transcriptEmpty = $derived(
    messages.length === 0 &&
      pendingMessages.length === 0 &&
      queuedMessages.length === 0 &&
      !queueRows?.length,
  );
  const turns = $derived(groupIntoTurns(messages, { preserveSystemRows: true }));
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
  <ScreenHeader
    class="items-center gap-1 px-2 py-1 border-b border-border bg-background"
    data-dock-chrome
  >
    {#snippet leading()}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={onBack}
        data-dock-conversation-back
        aria-label={m.ui_contentHeader_goBack_tooltip()}
        title={m.ui_contentHeader_goBack_tooltip()}><Fa icon={faArrowLeft} /></Button
      >
    {/snippet}
    {#snippet title()}
      <!-- Workspace first, agent below; the workspace avatar leads (the Assistant uses its own). -->
      {#snippet identity(picker: boolean)}
        <span class="dock-header-avatar" data-dock-header-avatar aria-hidden="true">
          {#if isAssistant}<AgentAvatar specialist="chief-of-staff" variant="emphasized" />
          {:else if workspace}<DockWorkspaceAvatar item={{ workspace }} variant="emphasized" />
          {:else}<AgentAvatar agentId={agentId ?? ''} variant="emphasized" />{/if}
        </span>
        <span class="min-w-0 flex-1 text-left" data-dock-header-identity>
          <span
            class="type-caption block truncate font-medium text-foreground"
            title={workspaceTitle}
            data-dock-header-workspace>{workspaceTitle}</span
          >
          <span
            class="type-caption flex min-w-0 items-center gap-1 text-muted-foreground"
            data-dock-header-agent
            ><span class="truncate" title={agentName}>{agentName}</span>{#if picker}<Fa
                icon={faChevronDown}
                class="size-2.5 shrink-0"
              />{/if}</span
          >
        </span>
      {/snippet}
      {#if agents.length > 1}
        <Select.Root value={agentId ?? ''} items={choices} onchange={onSelectAgent}>
          <Select.Trigger
            variant="ghost"
            class="h-auto min-h-(--control-height-large) w-full min-w-0 justify-start gap-2.5 px-1.5 py-1"
            aria-label={m.dock_conversation_agent_ariaLabel()}
          >
            {@render identity(true)}
          </Select.Trigger>
          <Select.Content portal={false} class="max-h-48 max-w-[calc(100vw-2rem)]">
            {#each agents as option (option.id)}
              <Select.Item value={option.id} label={option.name}>
                <span class="flex min-w-0 items-center gap-2">
                  <AgentAvatar agentId={option.id} variant="compact" class="shrink-0" />
                  <span class="truncate" title={option.name}>{option.name}</span>
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {:else}
        <!-- The heading names the conversation: workspace, then agent. -->
        <h2
          class="flex min-w-0 items-center gap-2.5 px-1.5 py-1 min-h-(--control-height-large)"
          aria-label={`${workspaceTitle}, ${agentName}`}
        >
          {@render identity(false)}
        </h2>
      {/if}
    {/snippet}
    {#snippet actions()}
      {#if mediaStatus}
        <span
          class="dock-media-status"
          role="status"
          data-live={mediaStatus.kind !== 'annotating' || undefined}
          title={mediaStatus.label}
        >
          <span class="dock-media-status-dot" aria-hidden="true"></span>
          <span class="truncate">{mediaStatus.label}</span>
        </span>
      {:else}<Button
          variant="ghost"
          size="icon-sm"
          onclick={onOpenWorkspace}
          aria-label={m.dock_conversation_openFull_ariaLabel()}
          title={m.dock_conversation_openFull_ariaLabel()}
          ><Fa icon={faArrowUpRightFromSquare} /></Button
        >{/if}
    {/snippet}
  </ScreenHeader>

  {#snippet noticeRail()}
    {#if notices?.register}
      {@const register = notices.register}
      <!-- Zero-height rail at the composer's top edge, in the composer lane. -->
      <div class="notice-rail">
        <ChatContentLane class="relative h-0">
          {#key notices.key}
            <DockConversationNotifications {register} />
          {/key}
        </ChatContentLane>
      </div>
    {/if}
  {/snippet}

  <div class="conversation-body" bind:clientHeight={bodyHeight}>
    <!-- A scrollable region must be keyboard-focusable so arrow keys and Page Up/Down scroll it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={scrollArea}
      class={`transcript-scroll ${CHAT_TRANSCRIPT_OVERFLOW_CLASS}`}
      data-message-controls-root
      onscroll={trackScroll}
      role="region"
      aria-label={m.dock_conversation_messages_ariaLabel()}
      aria-busy={loading}
      tabindex="0"
    >
      <ChatContentLane
        bind:element={transcript}
        class="transcript flex min-h-full flex-col pt-4 pb-3"
        operational
      >
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
        {#each turns as turn, index (turn.userMessage?.id ?? turn.bodyMessages[0]?.id ?? turn.noticeMessages[0]?.id)}
          {@const next = turns[index + 1]}
          {@const isLastTurn = index === turns.length - 1}
          {@const wake = turn.userMessage && isEventWakeMessage(turn.userMessage)}
          {@const hasBody = hasVisibleTurnBody({
            assistantMessages: turn.assistantMessages,
            hasVisibleNotice:
              turn.noticeMessages.length > 0 ||
              turn.bodyMessages.some((message) => message.role === 'system'),
            hasPendingStatus: isLastTurn && running,
            suppressCoordinationStoppedIndicator:
              !!turn.userMessage && isAutomatedChatMessage(turn.userMessage),
          })}
          {@const batched =
            !isAttentionQuestionAnswerSeam(turn, next) && isBatchedDeliverySeam(turn, next)}
          <div class="conversation-turn" data-conversation-turn>
            {#if turn.userMessage}
              {@const message = turn.userMessage}
              <div
                data-dock-message-id={message.id}
                data-dock-message-role={message.role}
                class={`canonical-message ${wake ? eventCardAssistantMarginClass(message, hasBody) : hasBody && !batched ? 'mb-6' : ''}`}
              >
                {#if wake}
                  <EventWakeupBanner
                    metadata={message.metadata as ComponentProps<
                      typeof EventWakeupBanner
                    >['metadata']}
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
                    suppressAutomatedWakeTopSpacing
                  />
                {/if}
              </div>
            {/if}
            {#each turn.noticeMessages as message (message.id)}
              <ChatTurnNotice {message} workspaceId={workspace?.id} />
            {/each}
            {#each turn.bodyMessages as message (message.id)}
              {@const lastAssistant =
                isLastTurn && message.id === turn.assistantMessages.at(-1)?.id}
              <div
                class="canonical-message"
                data-dock-message-id={message.id}
                data-dock-message-role={message.role}
              >
                <ChatTurnNotice {message} workspaceId={workspace?.id}>
                  {#snippet fallback()}
                    <ChatMessage
                      {message}
                      agentId={agentId ?? undefined}
                      {workspace}
                      {ownPrincipalId}
                      isStreaming={lastAssistant &&
                        (message.isStreaming ?? streamingStatus.isStreaming ?? false)}
                      isLastConversationMessage={lastAssistant}
                      suppressCoordinationStoppedIndicator={!!turn.userMessage &&
                        isAutomatedChatMessage(turn.userMessage)}
                    />
                  {/snippet}
                </ChatTurnNotice>
              </div>
            {/each}
          </div>
          {#if next}
            <ConversationTurnGap
              currentIsEventNotification={!!wake}
              currentHasAssistantMessages={turn.assistantMessages.length > 0}
              nextIsEventNotification={!!next.userMessage && isEventWakeMessage(next.userMessage)}
              nextHasUserMessage={!!next.userMessage}
              zeroToolSeam={hasOperationalAssistantTurnBoundary(turn, next)}
              batchedDeliverySeam={batched}
              attentionQuestionAnswerSeam={isAttentionQuestionAnswerSeam(turn, next)}
              subscriptionCardSeam={getSubscriptionCardSeam(
                isChatCardMessage(turn.userMessage) && !hasBody,
                isChatCardMessage(next.userMessage),
              )}
            />
          {/if}
        {/each}
        {#if running}
          <div class="pt-1 mb-2">
            <StreamingStatus {...streamingStatus} isProcessing={running} />
          </div>
        {/if}
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
      </ChatContentLane>
    </div>
    {#if newActivity}
      <div class="new-activity">
        <ScrollToBottomButton onclick={jumpToLatest} floating />
      </div>
    {/if}
  </div>

  {@render noticeRail()}
  <footer class="conversation-footer" bind:clientHeight={footerHeight}>
    <ChatContentLane composer>
      <QuestionComposer
        expanded={!!questions && questionsExpanded}
        active={notices?.active ?? true}
        maxHeight={questionMaxHeight}
      >
        {#snippet question()}
          {#if questions}
            <!-- Global: the card's block mounts with its parent; the enter still plays. -->
            <div
              class="dock-question"
              data-dock-questions
              in:fly|global={{ tier: 'moderate', distance: 6 }}
              out:fly|global={{ tier: 'fast', distance: 6 }}
            >
              {@render questions()}
            </div>
          {/if}
        {/snippet}
        {#if sendError}
          <div class="send-recovery">
            <InputMessage
              id={`${uid}-send-error`}
              tone="error"
              class="m-0 max-h-18 overflow-auto min-w-0 flex-1 break-words"
              >{sendError}</InputMessage
            >
            {#if canRetry}
              <Button
                variant="outline"
                size="sm"
                onclick={onRetrySend}
                disabled={sending || loading}
              >
                {m.chat_shared_retry_label()}
              </Button>
            {/if}
          </div>
        {/if}
        {#if attention && !questions}<div class="attention">
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
      </QuestionComposer>
    </ChatContentLane>
  </footer>
</section>

<style>
  /* The header's leading visual: the dock's 24px emphasized avatar, shown at 30px. */
  .dock-header-avatar {
    display: inline-flex;
    flex: none;
    --agent-avatar-emphasized-surface-size: 30px;
    --agent-avatar-emphasized-art-size: 24px;
    --agent-avatar-emphasized-clear-space: 3px;
    --agent-avatar-emphasized-corner-radius: 9px;
  }
  .dock-media-status {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 8rem;
    font-size: var(--text-caption-size);
    font-weight: 500;
  }
  .dock-media-status-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: hsl(var(--primary));
  }
  .dock-media-status[data-live] .dock-media-status-dot {
    background: hsl(var(--capture-active));
  }
  .dock-conversation {
    isolation: isolate;
    container: chat-panel / inline-size;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius-large);
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }
  .conversation-body {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .transcript-scroll {
    height: 100%;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    overflow-anchor: none;
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
  /* Banners overlay the transcript's bottom edge; the rail never takes layout space. */
  .notice-rail {
    position: relative;
    flex: none;
    height: 0;
    z-index: 2;
  }
  /* The card sits in the composer lane like the composer itself: no extra layer
     inset, bottom-aligned to the composer it covers, and only as tall as its content. */
  .conversation-footer :global([data-testid='question-wizard-slot']) {
    padding: 0;
    align-self: end;
  }
  .dock-question :global([data-question-wizard]) {
    max-width: none;
  }
  .conversation-footer {
    position: relative;
    flex: none;
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
  /* The side dock's rail already switches conversations: no back. */
  :global([data-placement='edge']) :global([data-dock-conversation-back]) {
    display: none;
  }
</style>
