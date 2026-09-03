import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function hasUnqualifiedClassToken(content: string, token: string) {
  return content.split(/[\s'"`]+/u).includes(token);
}

function openingTagAfter(content: string, anchor: string) {
  const anchorIndex = content.indexOf(anchor);
  const tagStart = content.indexOf('<div', anchorIndex);
  const tagClose = content.slice(tagStart).match(/\n\s*>/u);
  if (anchorIndex < 0 || tagStart < 0 || !tagClose || tagClose.index === undefined) {
    throw new Error(`Opening div not found after contract anchor: ${anchor}`);
  }
  const tagEnd = tagStart + tagClose.index + tagClose[0].length;
  return content.slice(tagStart, tagEnd);
}

describe('editorial conversation presentation contract', () => {
  it('assigns restored and streaming transcript identity to the outer row only', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const message = source('src/lib/components/chat/ChatMessage.svelte');

    expect(message).toContain('ownsMessageIdentity?: boolean;');
    expect(message).toContain('ownsMessageIdentity = true');
    expect(message).toContain('data-message-id={ownsMessageIdentity ? message?.id : undefined}');
    expect(message).toContain('data-message-role={ownsMessageIdentity ? role : undefined}');
    expect(panel.match(/ownsMessageIdentity=\{false\}/g)).toHaveLength(4);
    expect(panel.match(/message=\{pendingMessage\}[\s\S]{0,120}ownsMessageIdentity/g)).toBeNull();
  });

  it('allows variant-prefixed primary selection tokens', () => {
    const selectionClasses = 'selection:bg-primary selection:text-primary-foreground';

    expect(hasUnqualifiedClassToken(selectionClasses, 'bg-primary')).toBe(false);
    expect(hasUnqualifiedClassToken(selectionClasses, 'text-primary-foreground')).toBe(false);
  });

  it('detects unqualified primary user-surface tokens', () => {
    const primarySurfaceClasses = 'rounded-lg bg-primary text-primary-foreground';

    expect(hasUnqualifiedClassToken(primarySurfaceClasses, 'bg-primary')).toBe(true);
    expect(hasUnqualifiedClassToken(primarySurfaceClasses, 'text-primary-foreground')).toBe(true);
  });

  it('caps transcript, questions, and composer content at the approved 140em measure', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    expect(panel).toContain(
      'conversation-column chat-content-measure mx-auto flex min-h-full w-full min-w-0 flex-col',
    );
    expect(panel).not.toContain('max-w-[var(--content-measure-wide)]');
    expect(panel).toContain('<div class="w-full" data-testid="question-wizard-slot">');
    expect(panel).toContain("? 'w-full px-3!'");
    expect(panel).toContain(": 'w-full px-4 sm:px-6'");
    expect(panel).toContain('conversation-composer relative z-10 w-full');
    expect(panel).toContain(
      'class="composer-prompt-lane chat-content-measure mx-auto w-full min-w-0"',
    );
    expect(panel).toContain('data-testid="chat-composer-controls-inner"');
    expect(panel).toContain('edgeDocked');
    expect(panel).not.toContain("'px-[5%]'");
  });

  it('pins one user prompt in an independent overlay without moving the source row', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const pinned = source('src/lib/components/chat/PinnedUserPrompt.svelte');
    const message = source('src/lib/components/chat/ChatMessage.svelte');
    const surface = source('src/lib/components/chat/user-message-surface.ts');

    expect(panel).not.toContain('formatMessageForStickyHeader');
    expect(panel).not.toContain('h-0 overflow-visible');
    expect(panel).toContain("import PinnedUserPrompt from './PinnedUserPrompt.svelte';");
    expect(panel).toContain('trackPinnedPrompt,');
    expect(panel).toContain('use:trackPinnedPrompt={{');
    expect(panel).toContain('data-pinnable-user-prompt');
    expect(panel).toContain('data-pinned-prompt-id={message.id}');
    expect(panel).toContain('data-conversation-turn');
    expect(panel).toContain('<PinnedUserPrompt');
    expect(panel).toContain('text={getPinnedPromptText(pinnedPrompt.message)}');
    expect(panel).toContain('onActivate={handlePinnedPromptClick}');
    expect(panel).toContain(':global(.conversation-turn) {\n    contain: style;');
    expect(panel).toContain(':global(.message-nav-target) {\n    contain: style;');
    expect(panel).not.toContain('contain: style paint');
    expect(pinned).toContain('data-testid="pinned-user-prompt"');
    expect(pinned).toContain('USER_MESSAGE_SURFACE_CLASS');
    expect(pinned).toContain('USER_MESSAGE_TEXT_CLASS');
    expect(pinned).toContain('truncate whitespace-nowrap');
    expect(message).toContain(': USER_MESSAGE_TEXT_CLASS}');
    expect(hasUnqualifiedClassToken(surface, 'bg-sidebar')).toBe(true);
    expect(surface).toContain('text-secondary-foreground');
    expect(surface).not.toMatch(/(?:dark|light):bg-/);
    expect(hasUnqualifiedClassToken(surface, 'bg-muted')).toBe(false);
    expect(hasUnqualifiedClassToken(surface, 'bg-secondary')).toBe(false);
    expect(hasUnqualifiedClassToken(surface, 'border')).toBe(false);
    expect(hasUnqualifiedClassToken(surface, 'border-border')).toBe(false);
    expect(hasUnqualifiedClassToken(surface, 'bg-primary')).toBe(false);
    expect(hasUnqualifiedClassToken(surface, 'text-primary-foreground')).toBe(false);
  });

  it('keeps the pinned row stable while its turn spans the container top (no sticky flicker)', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    // Native scroll anchoring and the height ledger now cooperate to hold the
    // source row while the independent overlay changes at the container edge.
    expect(panel).toContain('style="scrollbar-gutter: stable;"');
    expect(panel).not.toContain('overflow-anchor: none');

    // The overlay is derived from source-row geometry, so compaction cannot
    // change the source row's height or restart pin detection.
    expect(panel).toContain('enabled: isActive && containerHeight >= 400');
    const pinned = source('src/lib/components/chat/pinned-prompt.ts');
    expect(pinned).toContain(
      "const SELECTOR = '[data-pinnable-user-prompt][data-pinned-prompt-id]';",
    );
    expect(pinned).toContain("source.closest<HTMLElement>('[data-conversation-turn]')");
    expect(pinned).toContain('candidate.sourceBottom <= containerTop - ENTER_OFFSET');
    expect(pinned).toContain('candidate.turnBottom > containerTop + ENTER_OFFSET');
    expect(pinned).toContain('resizeObserver = new ResizeObserver(schedule);');
    expect(pinned).toContain('mutationObserver = new MutationObserver(() => {');

    // With native anchoring off, LazyTurn owns scroll compensation for ALL of
    // its height changes above the reader's viewport — placeholder <-> content
    // swaps AND late-settling content after a swap (the v2.37.0 one-shot
    // compensation missed the latter, showing as intermittent 20–30px jumps at
    // the top of the chat while scrolling; behavioral coverage in
    // lazy-turn-scroll-ledger.test.ts).
    const lazyTurn = source('src/lib/components/chat/LazyTurn.svelte');
    expect(lazyTurn).toContain(
      "import { createHeightLedger, snapshotScroller } from './lazy-turn-scroll-ledger';",
    );
    expect(lazyTurn).toContain('function setVisibleWithScrollCompensation(next: boolean)');
    // The swap path must capture the scroller geometry BEFORE the flush and
    // hand it to account(): a swap that shrinks scrollHeight can natively
    // clamp scrollTop at flush time, and only the pre-flush snapshot lets the
    // ledger preserve the reader's distance-from-bottom through that clamp
    // (the bottom-of-chat snap-back; behavioral coverage in
    // lazy-turn-scroll-ledger.test.ts).
    expect(lazyTurn).toContain('const preSwap = snapshotScroller(scrollRoot);');
    expect(lazyTurn).toContain('void tick().then(() => ledger.request(preSwap));');
    expect(lazyTurn).toContain('setVisibleWithScrollCompensation(true);');
    expect(lazyTurn).toContain('setVisibleWithScrollCompensation(false);');
    // The ResizeObserver path must reconcile the ledger FIRST on EVERY fire
    // (before the shouldRenderContent early-return) so post-swap settles are
    // caught in the same frame.
    expect(lazyTurn).toMatch(
      /if \(!entry\) return;\s*\n[\s\S]{0,700}?ledger\.requestBeforePaint\(\);/,
    );
    expect(lazyTurn).toMatch(
      /ledger\.requestBeforePaint\(\);[\s\S]{0,1600}?if \(!shouldRenderContent\) return;/,
    );
    // Cached heights are panel-scoped and wrap-width-dependent. ChatPanel
    // owns the bounded cache, while each LazyTurn validates reads and writes.
    expect(lazyTurn).toContain("type LazyTurnHeightCache } from './lazy-turn-height-cache';");
    expect(lazyTurn).toContain('heightCache: LazyTurnHeightCache;');
    expect(lazyTurn).toContain('const initialCachedHeight = heightCache.get(turnKey, null);');
    expect(lazyTurn).toContain('heightCache.get(turnKey, observedWidth)');
    expect(lazyTurn).toContain('heightCache.set(turnKey, height, measuredWidth);');
    expect(panel).toContain("createLazyTurnHeightCache('unbound')");
    expect(panel).toContain('heightCache={lazyTurnHeightCache}');
  });

  it('does not restore the removed date separators', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    expect(panel).not.toContain('DateSeparator');
  });

  it('left-aligns user and assistant message wrappers', () => {
    const message = source('src/lib/components/chat/ChatMessage.svelte');

    expect(message).toMatch(
      /role === 'user'[\s\S]{0,80}\? 'user-message'[\s\S]{0,80}: 'relative assistant-message'/,
    );
    expect(message).not.toContain('assistant-message px-1 sm:px-2');
  });

  it('uses vertical rhythm instead of decorative separators between routine turns', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const gap = source('src/lib/components/chat/ConversationTurnGap.svelte');

    expect(panel).toContain('<!-- Editorial rhythm between turns');
    expect(panel).toContain('<ConversationTurnGap');
    expect(gap).toContain('data-testid="conversation-turn-gap"');
    expect(gap).toContain(": 'h-8'");
    expect(panel).not.toContain('<hr class="border-t border-border/50 mb-3" />');
  });

  it('uses the canonical sidebar user prompt surface and semantic body typography', () => {
    const message = source('src/lib/components/chat/ChatMessage.svelte');
    const markdown = source('src/lib/components/markdown/MarkdownViewer.svelte');

    expect(message).toContain(
      "import { USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS } from './user-message-surface'",
    );
    expect(message).toContain(': USER_MESSAGE_SURFACE_CLASS}');
    expect(message).not.toContain('rounded-lg border border-border/60 bg-accent/40');
    expect(message).toContain(': USER_MESSAGE_TEXT_CLASS}');
    expect(message).toContain('<div class="type-body text-pretty text-foreground">');
    expect(markdown).toContain('font-size: var(--text-body-size)');
    expect(markdown).toContain('font-weight: var(--text-body-strong-weight)');
  });

  it('uses one vertical rhythm for static, streaming, and expanded response rows', () => {
    const staticContent = source('src/lib/components/chat/MessageContent.svelte');
    const streamingContent = source('src/lib/components/chat/StreamingMessageContent.svelte');
    const responseGroup = source('src/lib/components/chat/ResponseGroup.svelte');
    const operationalRow = source('src/lib/components/chat/operational-disclosure-row.ts');

    expect(staticContent).toContain('<div class="flex flex-col gap-0"');
    expect(streamingContent).toContain('class="relative flex flex-col gap-0"');
    expect(staticContent.match(/{@render renderResponseGroupChild\(/g)).toHaveLength(2);
    expect(staticContent).toContain('{#if shouldRenderResponseGroupInline(group)}');
    expect(streamingContent).toContain('getOperationalClusterSpacingClass(');
    expect(streamingContent).toContain(
      '{@render renderResponseGroupChild(group, blockIndex, childBlock, childIndex)}',
    );
    expect(streamingContent).toContain('{#if shouldRenderResponseGroupInline(group)}');
    expect(streamingContent).toContain('isAdjacentOperationalClusterRow(');
    expect(streamingContent).toContain('isVisibleTopLevelBlock,');
    expect(streamingContent).toContain('data-operational-cluster-row=');
    expect(streamingContent).not.toContain('my-1.25');
    expect(streamingContent).not.toContain('margin-top: -0.5rem');
    expect(responseGroup).toContain('<div class="relative flex flex-col gap-0"');
    expect(staticContent).not.toContain("'mb-1.5'");
    expect(streamingContent).not.toContain('class:mb-1.5');
    expect(operationalRow).toContain('OPERATIONAL_EXPANDED_CONTENT_CLASS = `${');
    expect(operationalRow).toContain('OPERATIONAL_GROUP_CONTENT_CLASS');
    expect(operationalRow).not.toContain('OPERATIONAL_EXPANDED_GUIDE_CLASS');
    expect(responseGroup).toContain('data-operational-expanded-guide');
    expect(staticContent).toContain('OPERATIONAL_GROUP_CHILD_CONTENT_CLASS');
    expect(streamingContent).toContain('OPERATIONAL_GROUP_CHILD_CONTENT_CLASS');
    expect(staticContent).toContain('OPERATIONAL_GROUP_CHILD_ROW_CLASS');
    expect(streamingContent).toContain('OPERATIONAL_GROUP_CHILD_ROW_CLASS');
    expect(responseGroup).not.toContain('pl-4.5');
    expect(staticContent).toMatch(/nested,\s+isAdjacentOperationalClusterRow\(\s*group\.children,/);
    expect(streamingContent).toMatch(
      /nested,\s+isAdjacentOperationalClusterRow\(\s*group\.children,/,
    );
  });

  it('uses quieter Chief message surfaces and renders proposals inline in the transcript', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const streaming = source('src/lib/components/chat/StreamingMessageContent.svelte');
    const messageContent = source('src/lib/components/chat/MessageContent.svelte');

    expect(panel).not.toContain('class:bg-sidebar={isChiefWorkspace}');
    expect(panel).toContain("<div class={isChiefWorkspace ? 'mx-1 sm:mx-2' : ''}>");
    expect(panel.match(/message=\{pendingMessage\}[\s\S]{0,80}\{workspace\}/g)).toHaveLength(2);
    // Both transcript renderers mount the shared inline proposal host.
    expect(streaming).toContain('InlineProposal');
    expect(messageContent).toContain('InlineProposal');
  });

  it('keeps user rows transparent with the opaque surface on the bubble itself', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const message = source('src/lib/components/chat/ChatMessage.svelte');

    expect(panel).not.toContain('class:bg-sidebar={isChiefWorkspace}');
    expect(panel).not.toContain('class:bg-card={!isChiefWorkspace}');
    // The window spans the LazyTurn virtualization wrapper between the
    // always-mounted nav-target div and the inner bubble surface.
    expect(panel).toMatch(
      /message-nav-target relative z-20[\s\S]{0,1400}<div class=\{isChiefWorkspace \? 'mx-1 sm:mx-2' : ''\}>/,
    );
    expect(panel).not.toContain('chief-sticky-message-mask');
    expect(panel).not.toContain('backdrop-filter: blur(24px)');
    expect(message).toContain(': USER_MESSAGE_SURFACE_CLASS}');
    expect(message).not.toContain('stickySurfaceClass');
  });

  it('uses the shared 16px five-arm Intent mark instead of the legacy square spinner', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const status = source('src/lib/components/chat/StreamingStatus.svelte');
    const indicator = source('src/lib/components/chat/StreamingTypingIndicator.svelte');
    const loader = source('src/lib/components/ui/indicators/IntentMarkLoader.svelte');
    const indicators = source('src/lib/components/ui/indicators/index.ts');

    expect(panel).toContain("import StreamingStatus from './StreamingStatus.svelte'");
    expect(panel).not.toContain('LiveStreamPhaseIndicator');
    expect(status).toContain(
      "import StreamingTypingIndicator from './StreamingTypingIndicator.svelte'",
    );
    expect(indicators).toContain(
      "export { default as IntentMarkLoader } from './IntentMarkLoader.svelte';",
    );
    expect(indicator).toContain('<IntentMarkLoader {variant} size={16} playing={visible} />');
    expect(loader.match(/data-mark-arm=/g)).toHaveLength(5);
    expect(loader).toContain('stroke: currentColor');
    for (const legacyToken of [
      'legacy-streaming-spinner',
      'legacy-spinner-square',
      'legacy-spinner-wave',
    ]) {
      expect(indicator).not.toContain(legacyToken);
    }
  });

  it('renders wake-up details as one compact disclosure surface', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const wakeup = source('src/lib/components/chat/EventWakeupBanner.svelte');
    const avatar = source('src/lib/components/chat/InlineAgentAvatar.svelte');

    const wakeupWrapper = openingTagAfter(
      panel,
      '<!-- Source wake-up row remains owned by this transcript turn. -->',
    );
    expect(wakeupWrapper).toContain('data-message-id={message.id}');
    expect(wakeupWrapper).toContain('data-message-index={globalIndex}');
    expect(wakeupWrapper).toContain('message-nav-target relative z-10');
    expect(wakeupWrapper).toContain('data-pinned-prompt-id={message.id}');
    expect(wakeupWrapper).toContain('use:attachPinnedPromptMessage={message}');
    expect(wakeupWrapper).toContain('eventCardAssistantMarginClass(');
    expect(wakeupWrapper).toContain('turn.assistantMessages.length > 0');
    expect(panel).toContain('class:mb-0={batchedDeliveryTurnSeam}');
    expect(panel).toContain('class:mb-5={!batchedDeliveryTurnSeam && isAutomatedMessage(message)}');
    expect(panel).toContain(
      'class:mb-7={!batchedDeliveryTurnSeam && !isAutomatedMessage(message)}',
    );
    expect(panel).toContain(
      '{@const prevTurn =\n' +
        '                    turns[turnIndex - 1] ??\n' +
        '                    conversationTurnIndex.groups[groupIndex - 1]?.turns.at(-1)}',
    );
    expect(panel).toContain(
      '{@const batchedSeamBefore = Boolean(\n' +
        '                    prevTurn &&\n' +
        '                    !isAttentionQuestionAnswerSeam(prevTurn, turn) &&\n' +
        '                    isBatchedDeliverySeam(prevTurn, turn),\n' +
        '                  )}',
    );
    expect(panel).toContain('suppressTopGap={batchedSeamBefore}');
    expect(panel).toContain('suppressAutomatedWakeTopSpacing={batchedSeamBefore}');
    expect(panel).not.toContain('data-testid="chat-scroll-to-bottom-button"');
    expect(panel).toContain('showAgentCards={!isDelegatedBackgroundTaskAgent}');
    expect(panel).not.toContain('agentEventsForCards');
    expect(wakeup).toMatch(/items-center gap-1.5 py-0.5 pr-2 pl-0 text-primary/);
    expect(wakeup).toContain('SUBSCRIPTION_CARD_CONTAINMENT_CLASS');
    expect(wakeup).toContain('SUBSCRIPTION_CARD_SURFACE_CLASS');
    expect(wakeup).toContain('{#if showSummary || (showAgentCards && agentEvents.length > 0)}');
    expect(wakeup).toContain('<InlineAgentAvatar');
    expect(wakeup).toContain('data-testid="event-wakeup-avatar-stack"');
    expect(wakeup).toContain('data-testid="event-wakeup-details"');
    expect(wakeup).toContain('m.events_activity_partFinished_label().trim()');
    expect(wakeup).not.toContain('<AgentCard');
    expect(avatar).toContain('<Tooltip.Trigger');
    expect(avatar).toContain('aria-label={onclick');
  });

  it('reveals message and suggestion actions for keyboard focus as well as hover', () => {
    const message = source('src/lib/components/chat/ChatMessage.svelte');
    const actionSurface = source('src/lib/components/chat/message-action-surface.ts');
    const suggestions = source('src/lib/components/chat/SuggestedPrompts.svelte');

    expect(actionSurface).toContain('group-focus-within:pointer-events-auto');
    expect(actionSurface).toContain('group-focus-within:opacity-100');
    expect(message).toContain('class="absolute right-1 z-10');
    expect(suggestions).toContain('group-focus-within:opacity-100');
    expect(suggestions).toContain('focus-visible:opacity-100');
    expect(suggestions).toContain('icon={faArrowRight}');
    expect(suggestions).not.toContain('faPaperPlane');
  });

  it('supports the nested ChatPanel composer without changing standalone chrome', () => {
    const input = source('src/lib/components/chat/input/SimpleRichInput.svelte');

    expect(input).toMatch(/edgeDocked\s*\?/);
    expect(input).toContain('rounded-lg border-0 bg-sidebar shadow-none');
    expect(input).toContain('rounded-lg border border-border shadow-(--elevation-raised)');
    expect(input).not.toContain(':global(.panel:not(.focused) .rich-input-container) {');
    expect(input).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('gives tool, context, and reasoning rows one shared muted shell', () => {
    const toolCall = source('src/lib/components/chat/ToolCall.svelte');
    const reasoning = source('src/lib/components/chat/ThinkingBlock.svelte');
    const contextEngine = source('src/lib/components/chat/ContextEngineToolCall.svelte');
    const sharedRow = source('src/lib/components/chat/ChatOperationalRow.svelte');
    const responseGroup = source('src/lib/components/chat/ResponseGroup.svelte');
    const operationalRow = source('src/lib/components/chat/operational-disclosure-row.ts');
    const agentTab = source('src/features/layout/tab-types/AgentTabType.svelte');

    expect(operationalRow).toContain('CHAT_OPERATIONAL_ROW_CLASS');
    expect(operationalRow).toContain('relative grid h-7 w-full min-w-0 max-w-full');
    expect(operationalRow).toContain(
      "CHAT_OPERATIONAL_SUMMARY_TONE_CLASS = 'font-normal text-muted-foreground'",
    );
    expect(operationalRow).toContain(
      "CHAT_OPERATIONAL_ICON_CLASS = 'h-[16px]! w-[16px]! shrink-0'",
    );
    expect(sharedRow).toContain('data-chat-operational-row');
    expect(sharedRow).not.toContain("{adjacentOperationalRow ? 'mt-1' : ''}");
    expect(sharedRow).not.toContain('margin-top: var(--chat-operational-row-gap');
    expect(sharedRow).toContain(
      'data-adjacent-operational-row={adjacentOperationalRow || undefined}',
    );
    for (const component of [toolCall, reasoning, contextEngine, responseGroup]) {
      expect(component).toContain("import ChatOperationalRow from './ChatOperationalRow.svelte'");
      expect(component).toContain('<ChatOperationalRow');
    }
    expect(toolCall).not.toContain('McpIcon');
    expect(toolCall).toContain('resolveToolLeadingIcon');
    expect(responseGroup).toContain('OPERATIONAL_GROUP_CONTENT_CLASS');
    expect(responseGroup).not.toContain('OPERATIONAL_ROW_LINE_CLASS');
    expect(agentTab).not.toContain('toggleShowReasoningBlocks');
    expect(agentTab).not.toContain('layout_agentTab_reasoningShow_tooltip');
  });

  it('lets ChatPanel own the bottom spacing without changing the tab behavior boundary', () => {
    const tab = source('src/features/layout/tab-types/AgentTabType.svelte');

    expect(tab).toContain('<div class="flex h-full min-h-0 w-full flex-1">');
    expect(tab).not.toContain('w-full h-full flex-1 flex pb-1.5');
  });

  it('compresses prompt and transcript bottom spacing in short chat panels', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const message = source('src/lib/components/chat/ChatMessage.svelte');
    const queueEdgeLayout = source('src/lib/components/chat/chat-queue-edge-layout.ts');

    expect(panel).toContain('const COMPACT_HEIGHT_ENTER = 600');
    expect(panel).toContain('const COMPACT_HEIGHT_EXIT = 640');
    expect(panel).toContain('const transcriptBottomInsetClass = $derived(');
    expect(panel).toContain('{transcriptBottomInsetClass}');
    expect(queueEdgeLayout).toContain("return isCompactMode ? 'pb-3' : 'pb-6'");
    expect(panel).toContain("isCompactMode ? 'pb-1 pt-2' : 'py-2'");
    expect(panel).not.toContain("'pb-1 pt-3'");
    expect(panel).not.toContain('eventSubscriptionsOwnEndGap');
    expect(panel).not.toContain('eventSubscriptionsVisible');
    expect(panel.match(/isCompactMode \? 'mb-2' : 'mb-16'/g)).toHaveLength(4);
    expect(panel).toContain("isCompactMode ? 'mb-2' : 'mb-8'");
    expect(panel).toContain('style="scrollbar-gutter: stable;"');
    expect(message).toContain('class="absolute right-1 z-10');
    expect(message).toContain('<MessageActions');
    expect(message).toContain('class="absolute right-1 z-10');
    expect(message).not.toContain('group-hover:grid-rows-[1fr]');
    expect(message).not.toContain('class="mt-1 flex items-center justify-end"');
    expect(panel).not.toContain('w-full pt-8 pb-12');
  });

  it('keeps the regular and Chief streaming Aurora backgrounds below queued messages', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    const auroraBackground = '<AuroraBackground {agentId} />';
    const regularAurora =
      'class="composer-aurora-host regular-panel-aurora-host pointer-events-none absolute inset-x-0 bottom-0 z-0 overflow-hidden"';
    const transcript = 'data-testid="chat-transcript-scroll-viewport"';
    const composer = 'class="conversation-composer relative z-10 w-full"';
    const chiefAurora =
      'class="composer-aurora-host pointer-events-none absolute -left-4 -right-2 -bottom-4 z-0 overflow-hidden"';
    const regularAuroraIndex = panel.indexOf(regularAurora);
    const regularBackgroundIndex = panel.indexOf(auroraBackground, regularAuroraIndex);
    const transcriptIndex = panel.indexOf(transcript);
    const composerIndex = panel.indexOf(composer);
    const chiefAuroraIndex = panel.indexOf(chiefAurora);
    const chiefBackgroundIndex = panel.indexOf(auroraBackground, chiefAuroraIndex);

    expect(regularAuroraIndex).toBeGreaterThan(-1);
    expect(regularBackgroundIndex).toBeGreaterThan(regularAuroraIndex);
    expect(regularBackgroundIndex).toBeLessThan(transcriptIndex);
    expect(transcriptIndex).toBeGreaterThan(regularAuroraIndex);
    expect(composerIndex).toBeGreaterThan(transcriptIndex);
    expect(chiefAuroraIndex).toBeGreaterThan(composerIndex);
    expect(chiefBackgroundIndex).toBeGreaterThan(chiefAuroraIndex);
    expect(panel.match(/<AuroraBackground \{agentId\} \/>/g)).toHaveLength(2);
    expect(panel).not.toContain('AuroraSofteningLayer');
    expect(panel).toContain('style:height={`calc(${composerHeight}px + 10rem)`}');
    expect(panel).toContain('height: calc(100% + 10rem)');
    expect(panel).toContain('class="relative z-20 mt-6 {isChiefWorkspace');
    expect(panel).not.toContain('regular-composer-aurora-host');
  });
});
