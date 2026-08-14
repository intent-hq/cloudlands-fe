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
    expect(panel).toContain('class:pb-8={!isChiefWorkspace && !isCompactMode}');
    expect(panel).toContain('conversation-composer relative z-20 w-full');
    expect(panel).toContain('edgeDocked');
    expect(panel).not.toContain("'px-[5%]'");
  });

  it('sticks the single user prompt without restoring the duplicate compact layer', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    expect(panel).not.toContain('formatMessageForStickyHeader');
    expect(panel).not.toContain('h-0 overflow-visible');
    expect(panel).toMatch(
      /data-message-role="user"[\s\S]{0,400}class:sticky=\{shouldEnableSticky\}/,
    );
    expect(panel).toMatch(
      /data-message-role="user"[\s\S]{0,440}class:-top-px=\{shouldEnableSticky\}/,
    );
    expect(panel).toMatch(
      /data-message-role="user"[\s\S]{0,300}class="message-nav-target relative z-20 mb-4/,
    );
    expect(panel).toContain('class:bg-sidebar={isChiefWorkspace}');
    expect(panel).toContain('class:bg-card={!isChiefWorkspace}');
    expect(panel).toContain(':global(.conversation-turn) {\n    contain: style;');
    expect(panel).toContain(':global(.message-nav-target) {\n    contain: style;');
    expect(panel).not.toContain('contain: style paint');
    expect(panel).toContain('isSticky={stickyMessageId === message.id}');
    expect(panel).toContain('onStickyClick={() => scrollUserMessageToTop(message.id)}');
    expect(panel).toMatch(
      /function scrollUserMessageToTop[\s\S]{0,500}closest\('\.conversation-turn'\)[\s\S]{0,160}smoothScrollTo\(target, 'start'\)/,
    );

    const message = source('src/lib/components/chat/ChatMessage.svelte');
    expect(message).toMatch(/isSticky \|\|[\s\S]{0,100}'line-clamp-2'/);
    expect(message).toContain(
      "agentAttribution\n                ? ''\n                : 'line-clamp-6'",
    );
    expect(message).toContain('imageBlocks.length > 0 && !isSticky');
    expect(message).toContain('fileBlocks.length > 0 && !isSticky');
    expect(message).toContain('transition: height var(--motion-slow) var(--ease-emphasized-out)');
    expect(message).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps the pinned row stable while its turn spans the container top (no sticky flicker)', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    // Native scroll anchoring must stay off: it compensates for the pinned row's
    // sticky compaction by shifting scrollTop, re-firing detection and un-pinning
    // the row in a per-frame loop (top-of-chat flicker).
    expect(panel).toContain('style="scrollbar-gutter: stable; overflow-anchor: none;"');

    // Hysteresis: the currently-pinned row's stay condition is keyed on the turn's
    // geometry only — never the sticky element's own rect — so its own height
    // change (line-clamp compaction) can never un-stick it.
    expect(panel).toContain(
      'const turnSpansTop = turnRect.top < scrollRect.top && turnRect.bottom > scrollRect.top;',
    );
    expect(panel).toMatch(
      /getAttribute\('data-message-id'\) === stickyMessageId[\s\S]{0,200}if \(turnSpansTop\) \{\s*foundSticky = stickyMessageId;/,
    );

    // With native anchoring off, LazyTurn owns scroll compensation for
    // placeholder <-> content swaps above the reader's viewport so height
    // deltas there cannot move the visible transcript.
    const lazyTurn = source('src/lib/components/chat/LazyTurn.svelte');
    expect(lazyTurn).toContain('function setVisibleWithScrollCompensation(next: boolean)');
    expect(lazyTurn).toMatch(/if \(!wasAboveViewport\) return;[\s\S]{0,300}scroller\.scrollTop \+= delta;/);
    expect(lazyTurn).toContain('setVisibleWithScrollCompensation(true);');
    expect(lazyTurn).toContain('setVisibleWithScrollCompensation(false);');
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

  it('uses an aligned accent user prompt and semantic body typography', () => {
    const message = source('src/lib/components/chat/ChatMessage.svelte');
    const markdown = source('src/lib/components/markdown/MarkdownViewer.svelte');

    expect(message).toContain('relative overflow-hidden py-2 pr-3 pl-0');
    expect(message).toContain(
      "workspace?.id === CHIEF_WORKSPACE_ID ? 'bg-transparent' : 'bg-card'",
    );
    expect(message).not.toContain('rounded-lg border border-border/60 bg-accent/40');
    expect(message).toContain(
      'class="type-body select-text font-medium! text-pretty text-foreground',
    );
    expect(message).toContain('<div class="type-body text-pretty text-foreground">');
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
    expect(message).toContain('relative overflow-hidden py-2 pr-3 pl-0 {stickySurfaceClass}');
    expect(message).toContain(
      "workspace?.id === CHIEF_WORKSPACE_ID ? 'bg-transparent' : 'bg-card'",
    );
  });

  it('uses the original Thinking indicator without the staged hydration line', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const status = source('src/lib/components/chat/StreamingStatus.svelte');
    const indicator = source('src/lib/components/chat/StreamingTypingIndicator.svelte');

    expect(panel).toContain("import StreamingStatus from './StreamingStatus.svelte'");
    expect(panel).not.toContain('LiveStreamPhaseIndicator');
    expect(status).toContain(
      "import StreamingTypingIndicator from './StreamingTypingIndicator.svelte'",
    );
    expect(status).toContain('<StreamingTypingIndicator visible message={statusMessage}');
    expect(indicator).toContain('getRandomColorsWithSeed(seed)');
    expect(indicator).toContain('--duration: 800ms');
    expect(indicator).toContain('animation: legacy-spinner-wave');
  });

  it('renders wake-up details as one compact sticky row', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    const wakeup = source('src/lib/components/chat/EventWakeupBanner.svelte');
    const agentCard = source('src/lib/components/chat/AgentCard.svelte');

    expect(panel).toMatch(
      /data-message-index=\{globalIndex\}[\s\S]{0,220}message-nav-target relative z-10[\s\S]{0,120}class:bg-sidebar=\{isChiefWorkspace\}[\s\S]{0,80}class:bg-card=\{!isChiefWorkspace\}/,
    );
    expect(panel).toContain('showAgentCards={!isDelegatedBackgroundTaskAgent}');
    expect(panel).not.toContain('agentEventsForCards');
    expect(wakeup).toMatch(
      /items-center gap-1.5 py-1.5 pr-3 pl-0 \{isSticky[\s\S]{0,80}\? stickySurfaceClass[\s\S]{0,50}: 'bg-transparent'/,
    );
    expect(wakeup).toContain("workspace?.id === CHIEF_WORKSPACE_ID ? 'bg-sidebar' : 'bg-card'");
    expect(wakeup).toContain('{#if showSummary && !(showAgentCards && agentEvents.length > 0)}');
    expect(wakeup).toContain('statusLabel={event.type ===');
    expect(wakeup).toContain('m.events_activity_partFinished_label().trim()');
    expect(wakeup).toContain('inline');
    expect(wakeup).toContain('hidePreview');
    expect(wakeup).not.toContain('isCompleted={event.type');
    expect(agentCard).toContain("? 'flex-row items-center gap-2'");
    expect(agentCard).toContain("? 'type-body items-center rounded-md");
    expect(agentCard).toContain("? 'inline-agent-card-header overflow-hidden'");
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
    expect(panel).toContain('class:pb-8={!isChiefWorkspace && !isCompactMode}');
    expect(panel).toContain("isCompactMode ? 'pb-1 pt-2' : 'pb-6 pt-4'");
    expect(panel).not.toContain("'pb-1 pt-3'");
    expect(panel).toContain("isCompactMode ? 'pb-1' : 'pb-4'");
    expect(panel.match(/isCompactMode \? 'mb-2' : 'mb-16'/g)).toHaveLength(4);
    expect(panel).toContain("isCompactMode ? 'mb-2' : 'mb-8'");
    expect(panel).toContain('style="scrollbar-gutter: stable; overflow-anchor: none;"');
    expect(message).toContain('pointer-events-none absolute bottom-0 right-0 z-10');
    expect(message).toContain('rounded-md bg-background/95 p-0.5');
    expect(message).toContain('group-hover:pointer-events-auto group-hover:opacity-100');
    expect(message).not.toContain('group-hover:grid-rows-[1fr]');
    expect(message).not.toContain('class="mt-1 flex items-center justify-end"');
    expect(panel).not.toContain('w-full pt-8 pb-12');
  });
});
