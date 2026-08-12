import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('editorial conversation presentation contract', () => {
  it('lets the transcript, questions, and composer fill the panel width', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    expect(panel).toContain('conversation-column flex min-h-full w-full flex-col');
    expect(panel).not.toContain('max-w-[var(--content-measure-wide)]');
    expect(panel).toContain('<div class="w-full pb-2">');
    expect(panel).toContain("? 'w-full px-1.5!'");
    expect(panel).toContain(": 'w-full px-4 sm:px-6'");
    expect(panel).toContain('class:pb-2={!isChiefWorkspace && !isCompactMode}');
    expect(panel).toContain('conversation-composer relative z-20 w-full');
    expect(panel).toContain('edgeDocked');
    expect(panel).not.toContain("'px-[5%]'");
  });

  it('pins a separate compact prompt without mutating the normal-flow source', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const pinned = source('src/lib/components/chat/PinnedUserPrompt.svelte');

    expect(panel).not.toContain('formatMessageForStickyHeader');
    expect(panel).not.toContain('h-0 overflow-visible');
    expect(panel).not.toContain('class:sticky={shouldEnableSticky}');
    expect(panel).not.toContain('class:-top-px={shouldEnableSticky}');
    expect(panel).toMatch(
      /data-message-role="user"[\s\S]{0,300}class="message-nav-target relative z-20 mb-4/,
    );
    expect(panel).toContain('class:bg-sidebar={isChiefWorkspace}');
    expect(panel).toContain('class:bg-card={!isChiefWorkspace}');
    expect(panel).toContain(':global(.conversation-turn) {\n    contain: style;');
    expect(panel).toContain(':global(.message-nav-target) {\n    contain: style;');
    expect(panel).not.toContain('contain: style paint');
    expect(panel).toContain('data-pinnable-user-prompt={!isAutomatedMessage(message)');
    expect(panel).toContain('pointer-events-none absolute inset-x-0 top-0 z-40');
    expect(panel).toContain('<PinnedUserPrompt');
    expect(panel).toContain('use:trackPinnedPrompt');
    expect(panel).toMatch(
      /function scrollUserMessageToTop[\s\S]{0,500}pinnedPromptMessageId = null[\s\S]{0,300}smoothScrollTo\(target, 'start'\)/,
    );
    expect(pinned).toContain('USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS');
    expect(pinned).toContain('data-surface-role="pinned-user-prompt-bubble"');
    expect(pinned).toContain('truncate whitespace-nowrap {USER_MESSAGE_TEXT_CLASS}');
    expect(pinned).toContain('title={text}');
    expect(pinned).toContain('class="sr-only"');

    const message = source('src/lib/components/chat/ChatMessage.svelte');
    expect(message).not.toContain('isSticky');
    expect(message).not.toContain('onStickyClick');
    expect(message).toContain(
      "agentAttribution\n                ? ''\n                : 'line-clamp-6'",
    );
    expect(message).toContain('imageBlocks.length > 0');
    expect(message).toContain('fileBlocks.length > 0');
    expect(message).toContain('transition: height var(--motion-slow) var(--ease-emphasized-out)');
    expect(message).toContain('@media (prefers-reduced-motion: reduce)');
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

    expect(panel).toContain('<!-- Editorial rhythm between turns');
    expect(panel).toContain('<div class="h-8" aria-hidden="true"></div>');
    expect(panel).not.toContain('<hr class="border-t border-border/50 mb-3" />');
  });

  it('uses an inset semantic user surface and body typography', () => {
    const message = source('src/lib/components/chat/ChatMessage.svelte');
    const markdown = source('src/lib/components/markdown/MarkdownViewer.svelte');

    expect(message).toContain('USER_MESSAGE_SURFACE_CLASS');
    expect(source('src/lib/components/chat/user-message-surface.ts')).toContain(
      'rounded-lg border border-border/50 bg-muted px-3 py-2 shadow-sm',
    );
    expect(message).toContain(
      "workspace?.id === CHIEF_WORKSPACE_ID ? 'bg-transparent' : 'bg-card'",
    );
    expect(message).toContain('class="{USER_MESSAGE_TEXT_CLASS} select-text');
    expect(message).toContain('class="type-body text-pretty text-foreground"');
    expect(message).toContain('<span class="sr-only">{m.chat_agentThread_you_label()}</span>');
    expect(message).toContain(
      '<span class="sr-only">{m.chat_agentThread_assistant_label()}</span>',
    );
    expect(message).toContain('data-conversation-role="user"');
    expect(message).toContain('data-conversation-role="assistant"');
    expect(markdown).toContain('font-size: var(--text-body-size)');
    expect(markdown).toContain('font-weight: var(--text-body-strong-weight)');
  });

  it('uses quieter Chief message surfaces and neutral proposal borders', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const streaming = source('src/lib/components/chat/StreamingMessageContent.svelte');
    const messageContent = source('src/lib/components/chat/MessageContent.svelte');

    expect(panel).toContain('class:bg-sidebar={isChiefWorkspace}');
    expect(panel).toContain("<div class={isChiefWorkspace ? 'mx-1 sm:mx-2' : ''}>");
    expect(panel.match(/message=\{pendingMessage\}[\s\S]{0,80}\{workspace\}/g)).toHaveLength(2);
    expect(streaming).toContain('neutralBorder={workspaceId === CHIEF_WORKSPACE_ID}');
    expect(
      messageContent.match(/neutralBorder=\{workspaceId === CHIEF_WORKSPACE_ID\}/g),
    ).toHaveLength(2);
  });

  it('gives Chief user messages an opaque semantic surface so sticky text cannot overlap', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const message = source('src/lib/components/chat/ChatMessage.svelte');

    expect(panel).toContain('class:bg-sidebar={isChiefWorkspace}');
    expect(panel).toContain('class:bg-card={!isChiefWorkspace}');
    expect(panel).toMatch(
      /class:bg-card=\{!isChiefWorkspace\}[\s\S]{0,220}<div class=\{isChiefWorkspace \? 'mx-1 sm:mx-2' : ''\}>/,
    );
    expect(panel).not.toContain('chief-sticky-message-mask');
    expect(panel).not.toContain('backdrop-filter: blur(24px)');
    expect(message).toContain(': USER_MESSAGE_SURFACE_CLASS');
    expect(source('src/lib/components/chat/user-message-surface.ts')).toContain('bg-muted');
    expect(message).toContain(
      "workspace?.id === CHIEF_WORKSPACE_ID ? 'bg-transparent' : 'bg-card'",
    );
  });

  it('uses the original Thinking indicator with the active response start time', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const status = source('src/lib/components/chat/StreamingStatus.svelte');
    const indicator = source('src/lib/components/chat/StreamingTypingIndicator.svelte');

    expect(panel).toContain("import StreamingStatus from './StreamingStatus.svelte'");
    expect(panel).not.toContain('LiveStreamPhaseIndicator');
    expect(status).toContain(
      "import StreamingTypingIndicator from './StreamingTypingIndicator.svelte'",
    );
    expect(status).toContain('startTime={streamingStartTime}');
    expect(indicator).toContain('getRandomColorsWithSeed(seed)');
    expect(indicator).toContain('--duration: 800ms');
    expect(indicator).toContain('animation: legacy-spinner-wave');
  });

  it('renders wake-up details as one compact normal-flow row', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const wakeup = source('src/lib/components/chat/EventWakeupBanner.svelte');
    const agentCard = source('src/lib/components/chat/AgentCard.svelte');

    expect(panel).toMatch(
      /data-message-index=\{globalIndex\}[\s\S]{0,220}message-nav-target relative z-10[\s\S]{0,120}class:bg-sidebar=\{isChiefWorkspace\}[\s\S]{0,80}class:bg-card=\{!isChiefWorkspace\}/,
    );
    expect(panel).toContain('showAgentCards={!isDelegatedBackgroundTaskAgent}');
    expect(panel).not.toContain('agentEventsForCards');
    expect(wakeup).toContain('items-center gap-1.5 bg-transparent py-1.5 pr-3 pl-0');
    expect(wakeup).not.toContain('isSticky');
    expect(wakeup).not.toContain('stickySurfaceClass');
    expect(wakeup).toContain('{#if showSummary && !(showAgentCards && agentEvents.length > 0)}');
    expect(wakeup).toContain('statusLabel={event.type ===');
    expect(wakeup).toContain('m.events_activity_partFinished_label().trim()');
    expect(wakeup).toContain('inline');
    expect(wakeup).toContain('hidePreview');
    expect(wakeup).not.toContain('isCompleted={event.type');
    expect(agentCard).toContain("? 'flex-row items-center gap-2'");
    expect(agentCard).toContain("? 'type-body items-center rounded-md");
    expect(agentCard).toContain("? 'inline-agent-card-header'");
    expect(agentCard).toContain('agent-card-header flex w-full min-w-0 max-w-full');
    expect(agentCard).toContain('<div class="relative shrink-0 {inline ?');
    expect(agentCard).toContain('{#if delegatedByName && !inline}');
    expect(agentCard).toContain('{#if inline && statusLabel}');
    expect(agentCard).toContain('max-w-[40%] shrink-0 truncate text-ui text-subtle');
    expect(agentCard).not.toContain('max-w-[52%]');
    expect(agentCard).not.toContain('· {statusLabel}');
    expect(agentCard).not.toContain('· Delegated by');
  });

  it('reveals message and suggestion actions for keyboard focus as well as hover', () => {
    const message = source('src/lib/components/chat/ChatMessage.svelte');
    const suggestions = source('src/lib/components/chat/SuggestedPrompts.svelte');

    expect(message.match(/group-focus-within:opacity-100/g)?.length).toBeGreaterThanOrEqual(2);
    expect(message).toContain('showOnHover={false}');
    expect(suggestions).toContain('group-focus-within:opacity-100');
    expect(suggestions).toContain('focus-visible:opacity-100');
    expect(suggestions).toContain('icon={faArrowRight}');
    expect(suggestions).not.toContain('faPaperPlane');
  });

  it('supports a top-divider-only docked composer without changing edit-mode chrome', () => {
    const input = source('src/lib/components/chat/input/SimpleRichInput.svelte');

    expect(input).toMatch(/edgeDocked\s*\?/);
    expect(input).toContain(
      'rounded-none border-x-0 border-b-0 border-t border-border bg-transparent shadow-none',
    );
    expect(input).toContain('rounded-lg border border-border shadow-(--elevation-raised)');
    expect(input).not.toContain(':global(.panel:not(.focused) .rich-input-container) {');
    expect(input).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps tool-call rows compact and dims their leading icon', () => {
    const toolCall = source('src/lib/components/chat/ToolCall.svelte');
    const reasoning = source('src/lib/components/chat/ThinkingBlock.svelte');
    const contextEngine = source('src/lib/components/chat/ContextEngineToolCall.svelte');
    const responseGroup = source('src/lib/components/chat/ResponseGroup.svelte');
    const operationalRow = source('src/lib/components/chat/operational-disclosure-row.ts');
    const agentTab = source('src/features/layout/tab-types/AgentTabType.svelte');

    expect(operationalRow).toContain(
      'relative flex min-h-5 w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden py-0',
    );
    expect(operationalRow).toContain('type-body font-family-child font-normal');
    expect(operationalRow).toContain("OPERATIONAL_PRIMARY_CLASS = 'text-muted-foreground'");
    expect(operationalRow).toContain("OPERATIONAL_SECONDARY_CLASS =\n  'text-ghost");
    expect(operationalRow).toContain('group-hover:text-muted-foreground');
    for (const component of [toolCall, reasoning, contextEngine]) {
      expect(component).toContain('OPERATIONAL_ROW_CONTAINER_CLASS');
    }
    for (const component of [toolCall, contextEngine]) {
      expect(component).toContain('COMPACT_TOOL_ROW_CLASS');
      expect(component).toContain('COMPACT_TOOL_ICON_BOX_CLASS');
      expect(component).toContain('COMPACT_TOOL_SENTENCE_CLASS');
    }
    expect(reasoning).toContain('OPERATIONAL_ROW_LINE_CLASS');
    expect(reasoning).toContain('OPERATIONAL_ICON_CLASS');
    expect(responseGroup).toContain('OPERATIONAL_ROW_TONE_CLASS');
    expect(responseGroup).toContain('OPERATIONAL_ROW_LINE_CLASS');
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

    expect(panel).toContain('const COMPACT_HEIGHT_ENTER = 600');
    expect(panel).toContain('const COMPACT_HEIGHT_EXIT = 640');
    expect(panel).toContain('class:pb-3={!isChiefWorkspace && isCompactMode}');
    expect(panel).toContain('class:pb-2={!isChiefWorkspace && !isCompactMode}');
    expect(panel).toContain("isCompactMode ? 'pb-1 pt-2' : 'py-2'");
    expect(panel).not.toContain("'pb-1 pt-3'");
    expect(panel).toContain('data-testid="subscription-flex-spacer"');
    expect(panel).toContain('<EventSubscriptionsCard');
    expect(panel).toContain('data-testid="queued-message-utility-area"');
    expect(panel.indexOf('<EventSubscriptionsCard')).toBeLessThan(
      panel.indexOf('data-testid="queued-message-utility-area"'),
    );
    expect(panel.indexOf('data-testid="queued-message-utility-area"')).toBeLessThan(
      panel.indexOf('conversation-composer relative z-20 w-full'),
    );
    expect(panel).not.toContain('<BackgroundHooksRow');
    expect(panel).not.toContain('<MonitoredPrsRow');
    expect(panel.match(/isCompactMode \? 'mb-2' : 'mb-16'/g)).toHaveLength(4);
    expect(panel).toContain("isCompactMode ? 'mb-2' : 'mb-8'");
    expect(panel).toContain('style="scrollbar-gutter: stable;"');
    expect(message).toContain('pointer-events-none absolute bottom-0 right-0 z-10');
    expect(message).toContain('rounded-md bg-background/95 p-0.5');
    expect(message).toContain('group-hover:pointer-events-auto group-hover:opacity-100');
    expect(message).not.toContain('group-hover:grid-rows-[1fr]');
    expect(message).not.toContain('class="mt-1 flex items-center justify-end"');
    expect(panel).not.toContain('w-full pt-8 pb-12');
  });
});
