import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { conversationMarkdown, hasConversationText } from './conversation-markdown';

const row = (role: AgentMessage['role'], text: string, extra = {}): AgentMessage => ({
  id: 'message-1',
  role,
  timestamp: '2026-09-21T00:00:00Z',
  contentBlocks: [{ type: 'text', text }],
  ...extra,
});

describe('conversationMarkdown', () => {
  it('short-circuits availability after visible text and rejects hidden-only history', () => {
    const laterContent = vi.fn(() => [{ type: 'text' as const, text: 'Later answer' }]);
    const laterRow = {
      ...row('assistant', ''),
      get contentBlocks() {
        return laterContent();
      },
    };
    expect(hasConversationText([row('user', 'Question'), laterRow])).toBe(true);
    expect(laterContent).not.toHaveBeenCalled();
    expect(
      hasConversationText([
        row('system', 'hidden'),
        row('assistant', '<supervisor>hidden</supervisor>'),
      ]),
    ).toBe(false);
  });

  it('exports readable loaded text in order, excluding system, tools and reasoning', () => {
    expect(
      conversationMarkdown([
        row('system', 'system instructions'),
        row('user', '**Question**'),
        row('assistant', '', {
          contentBlocks: [
            { type: 'thinking', thinking: 'private reasoning' },
            { type: 'tool_use', name: 'shell', input: { command: 'internal command' } },
            { type: 'text', text: 'Answer\n\n```ts\nconst x = 1;\n```' },
          ],
        }),
      ]),
    ).toBe('## User\n\n**Question**\n\n---\n\n## Assistant\n\nAnswer\n\n```ts\nconst x = 1;\n```');
  });

  it('removes hidden harness content and suggested prompts but preserves fenced examples', () => {
    expect(
      conversationMarkdown([
        row(
          'assistant',
          [
            '<supervisor>',
            'internal instructions',
            '</supervisor>',
            '<group:Thinking>',
            'Visible explanation',
            '</group>',
            '<agent_digest>internal state</agent_digest>',
            '```xml',
            '<supervisor>literal example</supervisor>',
            '```',
            '<!-- suggested-prompts',
            'Do more',
            '-->',
          ].join('\n'),
        ),
      ]),
    ).toBe(
      '## Assistant\n\nVisible explanation\n```xml\n<supervisor>literal example</supervisor>\n```',
    );
  });

  it('uses collaborator and agent presentation without mutating messages', () => {
    const rows = [
      row(
        'user',
        'Message from @guest (Guest), a collaborator (guest) of this workspace — not the workspace owner.\n\nHello',
        {
          author: { principalId: 'guest-id', login: 'guest', displayName: 'Guest' },
        },
      ),
      row('user', '[MESSAGE FROM AGENT Builder (agent-builder)]\n\nDone', {
        metadata: { type: 'agent_message', fromAgentId: 'agent-builder', fromAgentName: 'Builder' },
      }),
    ];
    const before = structuredClone(rows);
    expect(conversationMarkdown(rows, 'owner-id')).toBe(
      '## Guest\n\nHello\n\n---\n\n## Builder\n\nDone',
    );
    expect(rows).toEqual(before);
  });

  it('does not truncate large content and returns nothing for non-text history', () => {
    const text = 'A'.repeat(100_000);
    expect(conversationMarkdown([row('assistant', text)])).toBe(`## Assistant\n\n${text}`);
    expect(conversationMarkdown([])).toBe('');
    expect(conversationMarkdown([row('system', 'hidden'), row('assistant', '')])).toBe('');
  });
});
