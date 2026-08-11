import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentSession, Note } from '$shared/types';
import {
  compareAgentsByLastMessage,
  getAgentLauncherPreview,
  getNoteLauncherPreview,
  shouldShowAgentInLauncher,
} from '../utils/sidebar-launcher-preview';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('sidebar launcher hover previews', () => {
  it('sorts agents by their last message with unmessaged agents last', () => {
    const older = {
      id: 'older',
      messages: [{ timestamp: '2026-07-28T00:00:00.000Z' }],
    } as AgentSession;
    const newer = {
      id: 'newer',
      messages: [{ timestamp: '2026-07-28T00:01:00.000Z' }],
    } as AgentSession;
    const unmessaged = { id: 'unmessaged', messages: [] } as unknown as AgentSession;

    expect([older, unmessaged, newer].sort(compareAgentsByLastMessage).map(({ id }) => id)).toEqual(
      ['newer', 'older', 'unmessaged'],
    );
  });

  it('shows the latest user message and prefers the streaming response', () => {
    const agent = {
      id: 'agent-1',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          timestamp: '2026-07-28T00:00:00.000Z',
          contentBlocks: [{ type: 'text', text: '[Current view] Review @context[note] this UI' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          timestamp: '2026-07-28T00:00:01.000Z',
          contentBlocks: [{ type: 'text', text: 'Older response' }],
        },
      ],
    } as AgentSession;

    expect(getAgentLauncherPreview(agent, 'Streaming response')).toEqual({
      lastUserMessage: 'Review this UI',
      response: 'Streaming response',
    });
  });

  it('creates a readable note preview from markdown content', () => {
    const note = { content: '# Plan\n\nReview **hover previews**.' } as Note;
    expect(getNoteLauncherPreview(note)).toBe('Plan\n\nReview hover previews.');
  });

  it('shows only running or unread agents in the launcher', () => {
    const readAgent = { hasUnread: false } as AgentSession;
    const unreadAgent = { hasUnread: true } as AgentSession;

    expect(shouldShowAgentInLauncher(readAgent, false)).toBe(false);
    expect(shouldShowAgentInLauncher(readAgent, true)).toBe(true);
    expect(shouldShowAgentInLauncher(unreadAgent, false)).toBe(true);
  });

  it('wraps both agent and note launcher items in rich hover cards', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    expect(sidebar).toContain(
      'selectAgentSessionStreamingContent.select(appStore.state, agent.id)',
    );
    expect(sidebar).toContain('label: m.chat_agentThread_you_label(),');
    expect(sidebar).toContain('label: m.workspace_fileChanges_agent_label(),');
    expect(sidebar).toContain('rows={[{ text: getNoteLauncherPreview(note) }]}');
    expect(sidebar).toContain('if (open && agent.messages.length === 0)');
    expect(sidebar).toContain('void loadChatTranscript(agent.id)');
    expect(sidebar).toContain('shouldShowAgentInLauncher(agent, isRunning)');
    expect(sidebar).toContain('let openLauncherHoverKey = $state<string | null>(null)');
    expect(sidebar).toContain('open={openLauncherHoverKey === `agent:${agent.id}`}');
    expect(sidebar).toContain('open={openLauncherHoverKey === `note:${note.id}`}');
    expect(sidebar).toContain('grid-cols-[repeat(3,1.25rem)] gap-0');
    expect(sidebar).not.toContain('grid-cols-[repeat(3,1.25rem)] gap-0.5');
  });
});
