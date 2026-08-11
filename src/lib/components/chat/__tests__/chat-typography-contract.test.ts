import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('chat typography contract', () => {
  it('lets the transcript and composer fill the panel width', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');
    expect(panel).toContain('conversation-column flex min-h-full w-full flex-col');
    expect(panel).toContain('conversation-composer relative z-20 w-full');
    expect(panel).not.toContain('max-w-[var(--content-measure-');
  });

  it('keeps prose at body hierarchy and operational rows at caption hierarchy', () => {
    expect(source('src/lib/components/chat/ChatMessage.svelte')).toContain('type-body text-pretty');
    expect(source('src/lib/components/chat/ToolCall.svelte')).toContain('type-caption');
    expect(source('src/lib/components/chat/ResponseGroup.svelte')).toContain('type-caption');
    expect(source('src/lib/components/chat/ChatFileChangesSummary.svelte')).toContain(
      'type-caption',
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
    expect(pickerFiles[2]).toContain('<span class="text-xs truncate">{currentModelLabel}</span>');
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
    expect(metadataFiles.join('')).not.toMatch(/text-(?:xs|sm)|font-(?:semibold|bold)/);

    const divider = source('src/lib/components/chat/NewMessagesDivider.svelte');
    expect(divider).toContain('type-caption');
    expect(divider).toContain('whitespace-nowrap');
    expect(divider.match(/bg-border/g)).toHaveLength(2);
    expect(divider).not.toContain('text-accent');
    expect(divider).not.toContain('rounded-full');
  });
});
