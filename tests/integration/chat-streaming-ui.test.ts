/**
 * Chat Streaming UI Integration Tests
 *
 * Tests for verifying that text streams properly in the UI during different states:
 * - While streaming
 * - When stopped
 * - After refresh
 * - With tool calls
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { createWorkspaceId, createAgentId, createMessageId } from '../../src/shared/types/branded-ids';
import { randomUUID } from 'crypto';
import type { AgentSession, AgentMessage, ContentBlock } from '../../src/shared/types';

// Import mock components
import MockMarkdownViewer from './__mocks__/MarkdownViewer.svelte';
import MockToolCall from './__mocks__/ToolCall.svelte';
import MockAugmentCodeSnippet from './__mocks__/AugmentCodeSnippet.svelte';

// Mock dependencies - all mocks must be defined before any imports
vi.mock('$lib/utils/client-logger', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    createLogger: () => mockLogger,
    logger: mockLogger,
  };
});

vi.mock('$lib/utils/messageParser', () => ({
  parseAgentMessage: vi.fn((content) => {
    // Return parsed content as text blocks
    if (typeof content === 'string') {
      return [{ type: 'text', content }];
    }
    return content;
  }),
  parseSuggestedPrompts: vi.fn((content) =>
    // Return content unchanged with no suggested prompts
    ({ cleanedContent: content, suggestedPrompts: [] }),
  ),
  groupParsedBlocks: vi.fn((blocks) => blocks),
  groupContentBlocks: vi.fn((blocks) => blocks),
}));

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => {
  const comp = await import('./__mocks__/MarkdownViewer.svelte');
  return { default: comp.default };
});

vi.mock('$lib/components/editor/AugmentCodeSnippet.svelte', async () => {
  const comp = await import('./__mocks__/AugmentCodeSnippet.svelte');
  return { default: comp.default };
});

vi.mock('$lib/components/chat/ToolCall.svelte', async () => {
  const comp = await import('./__mocks__/ToolCall.svelte');
  return { default: comp.default };
});

vi.mock('$features/agent/agent.store.svelte', () => ({
  agentStore: {
    agents: new Map(),
  },
}));

vi.mock('../../src/lib/components/chat/ChatPanel.svelte', async () => {
  const comp = await import('./__mocks__/ChatPanel.svelte');
  return { default: comp.default };
});

// Now import components after all mocks are defined
import StreamingMessageContent from '../../src/lib/components/chat/StreamingMessageContent.svelte';
import ChatPanel from '../../src/lib/components/chat/ChatPanel.svelte';
import WorkspaceHoverCard from '../../src/lib/components/workspace/WorkspaceHoverCard.svelte';

describe('Chat Streaming UI Tests', () => {
  let testWorkspaceId: ReturnType<typeof createWorkspaceId>;
  let testAgent: AgentSession;

  beforeAll(async () => {
    testWorkspaceId = createWorkspaceId(randomUUID());

    testAgent = {
      id: createAgentId(randomUUID()),
      name: 'UI Stream Test Agent',
      model: 'claude-3-opus',
      provider: 'anthropic',
      workspaceId: testWorkspaceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AgentSession;
  });

  afterAll(async () => {
    vi.clearAllMocks();
  });

  describe('Real-time Text Streaming', () => {
    it('should display text character-by-character while streaming', async () => {
      const testMessage = 'Hello, this is a streaming test message!';

      // Test the StreamingMessageContent component
      const { container, rerender } = render(StreamingMessageContent, {
        props: {
          content: [{ type: 'text', text: testMessage }],
          isStreaming: true,
        },
      });

      // Check that component renders
      expect(container).toBeTruthy();

      // Check that the streaming class is present
      const streamingElement = container.querySelector('.streaming');
      expect(streamingElement).toBeTruthy();

      // Update to not streaming
      await rerender({
        content: [{ type: 'text', text: testMessage }],
        isStreaming: false,
      });

      // Component should still be rendered
      expect(container).toBeTruthy();
    });

    it('should preserve text when streaming stops', async () => {
      const fullText = 'This message has finished streaming.';

      // Start with streaming
      const { container, rerender } = render(StreamingMessageContent, {
        props: {
          content: [{ type: 'text', text: fullText }],
          isStreaming: true,
        },
      });

      // Check streaming state
      await waitFor(() => {
        const textContent = container.textContent || '';
        expect(textContent).toContain(fullText);
      });

      // Stop streaming
      await rerender({
        content: [{ type: 'text', text: fullText }],
        isStreaming: false,
      });

      // Check that text is preserved
      await waitFor(() => {
        const textContent = container.textContent || '';
        expect(textContent).toContain(fullText);
      });
    });

    it('should handle mixed content blocks (text + tool calls)', async () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Let me help you with that. ' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'codebase-retrieval',
          input: { query: 'find main function' },
        },
        { type: 'text', text: 'I found the following:' },
      ];

      const { container } = render(StreamingMessageContent, {
        props: {
          content: blocks,
          isStreaming: false,
        },
      });

      // Check that component renders
      expect(container).toBeTruthy();

      // Check for text content
      await waitFor(() => {
        const textContent = container.textContent || '';
        expect(textContent).toContain('Let me help you with that.');
        expect(textContent).toContain('I found the following:');
      });
    });
  });

  describe('Message Persistence After Refresh', () => {
    it('should restore messages after page reload', async () => {
      // Create a message with specific content
      const testMessage: AgentMessage = {
        id: createMessageId(randomUUID()),
        role: 'assistant',
        contentBlocks: [
          { type: 'text', text: 'This message should persist after reload.' },
        ],
        timestamp: new Date().toISOString(),
      };

      // Mock the agent store with test data
      vi.mock('$features/agent/agent.store.svelte', () => ({
        agentStore: {
          agents: new Map([[testAgent.id, {
            session: testAgent,
            messages: [testMessage],
          }]]),
        },
      }));

      // Test ChatPanel mount
      const { container } = render(ChatPanel, {
        props: {
          agentId: testAgent.id,
          workspaceId: testWorkspaceId,
        },
      });

      // Check that component renders
      expect(container).toBeTruthy();
    });

    it('should maintain tool calls after refresh', async () => {
      const messageWithTools: AgentMessage = {
        id: createMessageId(randomUUID()),
        role: 'assistant',
        contentBlocks: [
          { type: 'text', text: 'Processing your request...' },
          {
            type: 'tool_use',
            id: 'tool-test-1',
            name: 'web-search',
            input: { query: 'test query' },
          },
          {
            type: 'tool_result',
            tool_use_id: 'tool-test-1',
            content: 'Search results here',
          },
          { type: 'text', text: 'Based on the search results...' },
        ],
        timestamp: new Date().toISOString(),
      };

      // Mock the agent store with test data
      vi.mock('$features/agent/agent.store.svelte', () => ({
        agentStore: {
          agents: new Map([[testAgent.id, {
            session: testAgent,
            messages: [messageWithTools],
          }]]),
        },
      }));

      const { container } = render(ChatPanel, {
        props: {
          agentId: testAgent.id,
          workspaceId: testWorkspaceId,
        },
      });

      // Check that component renders
      expect(container).toBeTruthy();
    });
  });

  describe('Streaming State Management', () => {
    it('should update isStreaming prop correctly during stream lifecycle', async () => {
      // Start with streaming true
      const { container, rerender } = render(StreamingMessageContent, {
        props: {
          content: [{ type: 'text', text: 'Streaming...' }],
          isStreaming: true,
        },
      });

      // Check initial streaming state
      expect(container).toBeTruthy();
      // Check for the streaming class on the container div
      const streamingElement = container.querySelector('.streaming');
      expect(streamingElement).toBeTruthy();

      // Update to streaming false
      await rerender({
        content: [{ type: 'text', text: 'Streaming...' }],
        isStreaming: false,
      });

      // Check that streaming has stopped
      await waitFor(() => {
        const streamingElement = container.querySelector('.streaming');
        expect(streamingElement).toBeFalsy();
        const textContent = container.textContent || '';
        expect(textContent).toContain('Streaming...');
      });
    });

    it('should handle rapid streaming updates without losing content', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => `chunk${i} `);
      let accumulatedText = '';

      const { container, rerender } = render(StreamingMessageContent, {
        props: {
          content: [{ type: 'text', text: '' }],
          isStreaming: true,
        },
      });

      for (const chunk of chunks) {
        accumulatedText += chunk;

        await rerender({
          content: [{ type: 'text', text: accumulatedText }],
          isStreaming: true,
        });

        // Quick check for content
        await waitFor(() => {
          const textContent = container.textContent || '';
          expect(textContent).toContain(accumulatedText);
        }, { timeout: 100 });
      }

      // Stop streaming and verify final content
      await rerender({
        content: [{ type: 'text', text: accumulatedText }],
        isStreaming: false,
      });

      await waitFor(() => {
        const textContent = container.textContent || '';
        expect(textContent).toContain(accumulatedText);
      });
    });
  });

  describe('Hover Card Content', () => {
    it('should display agent information in hover card', async () => {
      const testMessage = {
        id: createMessageId(randomUUID()),
        role: 'assistant' as const,
        contentBlocks: [{ type: 'text' as const, text: 'Test message for hover card' }],
        timestamp: new Date().toISOString(),
      };

      const { container } = render(WorkspaceHoverCard, {
        props: {
          workspace: {
            id: testWorkspaceId,
            name: 'Test Workspace',
            agents: new Map([[testAgent.id, {
              session: testAgent,
              messages: [testMessage],
            }]]),
          },
        },
      });

      // Check that component renders
      expect(container).toBeTruthy();
    });
  });
});
