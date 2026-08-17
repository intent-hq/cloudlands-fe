import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AgentSession, Note } from '$shared/types';
import {
  compareAgentsByLastMessage,
  deriveAgentLauncherItems,
  getAgentLauncherPreview,
  getNoteLauncherPreview,
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

  it('includes every unique agent and prioritizes running then unread sessions', () => {
    const readAgent = { id: 'read', hasUnread: false, messages: [] } as unknown as AgentSession;
    const unreadAgent = {
      id: 'unread',
      hasUnread: true,
      messages: [],
    } as unknown as AgentSession;

    const result = deriveAgentLauncherItems(
      [readAgent, unreadAgent, readAgent],
      6,
      (agent) => agent.id === 'read',
      () => ({ lastUserMessage: '', response: '' }),
    );

    expect(result.launcherAgents.map(({ agent }) => agent.id)).toEqual(['read', 'unread']);
    expect(result.totalAgents).toBe(2);
  });

  it('builds previews only after filtering, ordering, and applying the launcher limit', () => {
    const agents = Array.from({ length: 8 }, (_, index) => ({
      id: `agent-${index}`,
      hasUnread: true,
      messages: [{ timestamp: `2026-07-28T00:00:0${8 - index}.000Z` }],
    })) as AgentSession[];
    const filteredAgent = {
      id: 'filtered-agent',
      hasUnread: false,
      messages: [{ timestamp: '2026-07-28T00:00:09.000Z' }],
    } as AgentSession;
    const buildPreview = vi.fn((agent: AgentSession) => ({
      lastUserMessage: agent.id,
      response: '',
    }));

    const result = deriveAgentLauncherItems(
      [filteredAgent, ...agents],
      6,
      (agent) => agent !== filteredAgent,
      buildPreview,
    );

    expect(result.launcherAgents.map(({ agent }) => agent.id)).toEqual([
      'agent-0',
      'agent-1',
      'agent-2',
      'agent-3',
      'agent-4',
      'agent-5',
    ]);
    expect(result.runningAgents.map(({ id }) => id)).toEqual(agents.map(({ id }) => id));
    expect(buildPreview.mock.calls.map(([agent]) => agent.id)).toEqual([
      'agent-0',
      'agent-1',
      'agent-2',
      'agent-3',
      'agent-4',
      'agent-5',
    ]);
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
    expect(sidebar).toContain('deriveAgentLauncherItems(');
    expect(sidebar).toContain('let openLauncherHoverKey = $state<string | null>(null)');
    expect(sidebar).toContain('open={openLauncherHoverKey === `agent:${agent.id}`}');
    expect(sidebar).toContain('open={openLauncherHoverKey === `note:${note.id}`}');
    expect(sidebar).toContain(
      'isolate grid h-9 w-full min-w-0 grid-flow-col items-start overflow-visible',
    );
    expect(sidebar).toContain('data-launcher-pack="left"');
  });
});
