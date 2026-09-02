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

  it('shows the wire lastUserMessage and serves the wire lastAgentResponse', () => {
    // Both previews come from the wire AgentLite fields (PROTOCOL §5.5) —
    // no stream-buffer override; while streaming the daemon push-applies
    // lastAgentResponse (~1s agent:stream:activity cadence, monorepo#2843).
    const agent = {
      id: 'agent-1',
      messages: [],
      lastUserMessage: '[Current view] Review @context[note] this UI',
      lastAgentResponse: 'Wire response',
    } as AgentSession;

    expect(getAgentLauncherPreview(agent)).toEqual({
      lastUserMessage: 'Review this UI',
      response: 'Wire response',
    });
  });

  it('keeps the wire lastAgentResponse while a live tool call is in flight', () => {
    // getAgentPeekData clears lastResponse in favor of the live tool overlay
    // (chip-capable surfaces render the tool); this text-only hover card
    // falls back to the wire lastAgentResponse instead of an empty row.
    const agent = {
      id: 'agent-1',
      messages: [],
      isStreaming: true,
      lastToolUse: { name: 'read_file' },
      lastUserMessage: 'Review this UI',
      lastAgentResponse: 'Text emitted before the tool call',
    } as AgentSession;

    expect(getAgentLauncherPreview(agent)).toEqual({
      lastUserMessage: 'Review this UI',
      response: 'Text emitted before the tool call',
    });
  });

  it('creates a readable note preview from markdown content', () => {
    const note = { content: '# Plan\n\nReview **hover previews**.' } as Note;
    expect(getNoteLauncherPreview(note)).toBe('Plan\n\nReview hover previews.');
  });

  it('falls back to contentPreview for slim rows whose content is not loaded', () => {
    const slim = {
      content: '',
      contentPreview: '# Plan\n\nSlim **preview** body.',
      contentLength: 500,
    } as Note;
    expect(getNoteLauncherPreview(slim)).toBe('Plan\n\nSlim preview body.');
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
    expect(sidebar).toContain('getAgentLauncherPreview(agent)');
    expect(sidebar).not.toContain('selectAgentSessionStreamingContent');
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

  it('delays launcher hover cards so a mouse pass-over never opens them', async () => {
    // Perf invariant (Trace-20260831T161502): opening a tooltip triggers
    // floating-ui measurement, so switch-path sidebar rows must require a
    // deliberate 400ms hover before opening.
    const { render, cleanup } = await import('@testing-library/svelte');
    const { default: SidebarLauncherHoverCard } =
      await import('../sidebar/SidebarLauncherHoverCard.svelte');
    try {
      const { container } = render(SidebarLauncherHoverCard, {
        props: { title: 'Agents', rows: [], emptyText: 'No agents yet', kind: 'agent' as const },
      });
      const trigger = container.querySelector('[data-tooltip-trigger]');
      expect(trigger).not.toBeNull();
      expect(trigger!.getAttribute('data-delay-duration')).toBe('400');
    } finally {
      cleanup();
    }
  });
});
