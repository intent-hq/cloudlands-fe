import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('chat typography contract', () => {
  it('caps transcript and composer content at the approved 70em measure', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    expect(panel).toContain(
      'conversation-column chat-content-measure mx-auto flex min-h-full w-full min-w-0 flex-col',
    );
    expect(panel).toContain('conversation-composer relative z-20 w-full');
    expect(panel).toContain('class="chat-content-measure mx-auto w-full min-w-0"');
    expect(panel).toContain('data-testid="chat-composer-controls-inner"');
    expect(panel).toContain('max-width: 70em');
    expect(panel).not.toContain('max-w-[var(--content-measure-');
  });

  it('keeps prose at body hierarchy and operational rows on the shared quiet tone', () => {
    expect(source('src/lib/components/chat/ChatMessage.svelte')).toContain('type-body text-pretty');
    expect(source('src/lib/components/chat/ToolCall.svelte')).toContain('<ChatOperationalRow');
    expect(source('src/lib/components/chat/operational-disclosure-row.ts')).toContain('type-body');
    expect(source('src/lib/components/chat/ResponseGroup.svelte')).toContain('<ChatOperationalRow');
    expect(source('src/lib/components/chat/ChatFileChangesSummary.svelte')).toContain(
      'CHAT_OPERATIONAL_ROW_CLASS',
    );
    expect(source('src/lib/components/chat/SuggestedPrompts.svelte')).toContain('type-caption');
  });

  it('uses design-system variables for markdown and composer typography', () => {
    const markdown = source('src/lib/components/markdown/MarkdownViewer.svelte');
    const editor = source('src/lib/components/chat/input/TipTapEditor.svelte');
    expect(markdown).toContain('font-size: var(--text-display-size)');
    expect(markdown).toContain('font-size: var(--text-title-size)');
    expect(markdown).toContain('font-family: var(--font-code)');
    expect(editor).toContain('font-size: var(--text-body-size)');
    expect(editor).not.toContain('font-size: 1rem');
  });

  it('uses semantic roles throughout queued messages and permission requests', () => {
    const queued = source('src/lib/components/chat/QueuedMessageList.svelte');
    const permission = source('src/lib/components/chat/InlinePermissionRequest.svelte');
    expect(queued).toContain('type-body');
    expect(queued).toContain('type-caption');
    expect(permission).toContain('type-body');
    expect(permission).toContain('type-caption');
    expect(permission).toContain('type-code');
    expect(`${queued}${permission}`).not.toMatch(/text-(?:xs|sm)|font-(?:semibold|bold)/);
  });

  it('normalizes model, context, and effort picker typography', () => {
    const pickerFiles = [
      'src/lib/components/chat/input/ContextPickerButton.svelte',
      'src/lib/components/chat/input/EffortPicker.svelte',
      'src/lib/components/chat/input/ModelPicker.svelte',
      'src/lib/components/chat/input/ModelPickerOptionItem.svelte',
      'src/lib/components/chat/input/ModelPickerGroupHeader.svelte',
      'src/lib/components/chat/input/ModelProviderErrorItem.svelte',
    ].map(source);
    expect(pickerFiles.join('')).toContain('type-body');
    expect(pickerFiles.join('')).toContain('type-caption');
    expect(pickerFiles.slice(0, 2).concat(pickerFiles.slice(3)).join('')).not.toMatch(
      /text-(?:xs|sm)|font-(?:semibold|bold)/,
    );
    expect(pickerFiles[2]).toContain('<span class="text-xs truncate">{triggerLabel}</span>');
  });

  it('keeps transcript metadata semantic and the unread divider neutral and legible', () => {
    const metadataFiles = [
      'src/lib/components/chat/ThinkingBlock.svelte',
      'src/lib/components/chat/MessageContent.svelte',
      'src/lib/components/chat/StreamingMessageContent.svelte',
      'src/lib/components/chat/AgentMessageAttributionHeader.svelte',
      'src/lib/components/chat/QueuedMessageNoticeHeader.svelte',
      'src/lib/components/chat/HookWakeAttributionHeader.svelte',
      'src/lib/components/chat/ContextChip.svelte',
    ].map(source);
    expect(metadataFiles.join('')).toContain('type-caption');
    expect(metadataFiles.join('')).toContain('type-code');
    expect(metadataFiles.join('')).not.toMatch(/text-xs|font-(?:semibold|bold)/);

    const divider = source('src/lib/components/chat/NewMessagesDivider.svelte');
    expect(divider).toContain('type-caption');
    expect(divider).toContain('whitespace-nowrap');
    expect(divider.match(/bg-border/g)).toHaveLength(2);
    expect(divider).not.toContain('faEnvelope');
    expect(divider).not.toContain('text-accent');
    expect(divider).not.toContain('rounded-full');
  });

  it('keeps collapsed event summaries canonical and expanded report roles compact', () => {
    const wake = source('src/lib/components/chat/EventWakeupBanner.svelte');
    const agentCard = source('src/lib/components/chat/AgentCard.svelte');
    for (const token of [
      'event-wakeup-agent-name',
      'event-wakeup-status',
      'event-wakeup-timestamp',
      'event-wakeup-report',
      'max-w-[68ch]',
      'tabular-nums',
    ]) {
      expect(wake).toContain(token);
    }
    expect(agentCard).toContain('data-testid="agent-card-status"');
    expect(agentCard).toContain(
      'type-body shrink-0 truncate whitespace-nowrap font-normal text-muted-foreground',
    );
    expect(agentCard).toContain('type-body shrink-0 truncate');
    expect(wake).toContain('type-body min-w-0 truncate font-normal text-muted-foreground');
    expect(wake).not.toContain('type-body min-w-0 truncate font-medium text-foreground');
    expect(wake).not.toMatch(/type-(?:title|display)|text-(?:base|lg|xl|2xl)/);
  });

  it('shares opaque muted body summaries and 16px event chevrons', () => {
    const subscription = source('src/lib/components/chat/subscription-disclosure.ts');
    const operational = source('src/lib/components/chat/operational-disclosure-row.ts');
    const eventFiles = [
      'src/lib/components/chat/AgentMessageAttributionHeader.svelte',
      'src/lib/components/chat/AgentSubscriptions.svelte',
      'src/lib/components/chat/AutomatedWakeCardHeader.svelte',
      'src/lib/components/chat/DelegationGroupSection.svelte',
      'src/lib/components/chat/BackgroundHooksRow.svelte',
      'src/lib/components/chat/MonitoredPrsRow.svelte',
    ].map(source);
    expect(subscription).toContain("font-normal text-muted-foreground!'");
    expect(subscription).not.toContain('text-muted-foreground/');
    expect(subscription).toContain("SUBSCRIPTION_CHEVRON_SIZE_CLASS = 'h-[16px]! w-[16px]!'");
    expect(operational).toContain(
      "CHAT_OPERATIONAL_SUMMARY_TONE_CLASS = 'font-normal text-muted-foreground'",
    );
    expect(operational).toContain("'h-[16px]! w-[16px]! shrink-0 opacity-60");
    expect(eventFiles.join('')).not.toMatch(
      /type-caption[^\n]*(?:summary|status)|text-ghost[^\n]*\{/,
    );
  });
});
