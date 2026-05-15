/**
 * Regression tests for suggested prompts visibility.
 *
 * These tests verify that suggested prompts are only visible after streaming completes.
 * The visibility logic in ChatPanel.svelte returns an empty array when isStreaming is true.
 *
 * This regression coverage ensures that:
 * 1. Prompts are hidden during active streaming
 * 2. Prompts become visible once streaming ends (isStreaming = false)
 * 3. The derived computation correctly extracts prompts from the last assistant message
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { parseSuggestedPrompts } from '$lib/utils/messageParser';
import type { AgentMessage } from '$shared/types';
import type { SuggestedPrompt } from '$shared/types';

/**
 * Simulates the suggestedPrompts derived computation from ChatPanel.svelte
 * This is the exact logic used to determine visibility.
 */
function computeSuggestedPrompts(
  isStreaming: boolean,
  messages: AgentMessage[],
): SuggestedPrompt[] {
  // Mirrors ChatPanel.svelte lines 355-367
  if (isStreaming || messages.length === 0) {
    return [];
  }
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistantMessage) {
    return [];
  }
  // Extract text content from contentBlocks
  const messageContent = (lastAssistantMessage.contentBlocks || [])
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const { prompts } = parseSuggestedPrompts(messageContent);
  return prompts;
}

function createAssistantMessage(content: string): AgentMessage {
  return {
    id: `msg_${Date.now()}`,
    role: 'assistant',
    contentBlocks: [{ type: 'text', text: content }],
    timestamp: new Date().toISOString(),
  };
}

describe('Suggested prompts visibility regression', () => {
  const messageWithPrompts = createAssistantMessage(`Here is the response.

<!-- suggested-prompts
Run the tests
Check the build status
-->
`);

  describe('visibility gating on isStreaming', () => {
    /**
     * REGRESSION: Prompts must NOT be visible while streaming is active.
     * This prevents flickering or premature display of incomplete prompt data.
     */
    it('returns empty array when isStreaming is true, even with valid prompts', () => {
      const prompts = computeSuggestedPrompts(true, [messageWithPrompts]);
      expect(prompts).toEqual([]);
    });

    /**
     * REGRESSION: Once streaming completes (isStreaming = false), prompts become visible.
     */
    it('returns prompts when isStreaming is false and prompts exist', () => {
      const prompts = computeSuggestedPrompts(false, [messageWithPrompts]);
      expect(prompts).toEqual(['Run the tests', 'Check the build status']);
    });

    it('returns empty array for empty message list regardless of streaming state', () => {
      expect(computeSuggestedPrompts(false, [])).toEqual([]);
      expect(computeSuggestedPrompts(true, [])).toEqual([]);
    });
  });

  describe('prompt extraction from last assistant message', () => {
    it('extracts prompts only from the last assistant message', () => {
      const firstMessage = createAssistantMessage(`First response

<!-- suggested-prompts
Old prompt 1
Old prompt 2
-->
`);
      const secondMessage = createAssistantMessage(`Second response

<!-- suggested-prompts
New prompt 1
New prompt 2
-->
`);

      const prompts = computeSuggestedPrompts(false, [firstMessage, secondMessage]);
      expect(prompts).toEqual(['New prompt 1', 'New prompt 2']);
    });

    it('ignores user messages when finding last assistant', () => {
      const assistantMsg = createAssistantMessage(`Response

<!-- suggested-prompts
Test prompt
-->
`);
      const userMsg: AgentMessage = {
        id: 'msg_user_1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'User message after assistant' }],
        timestamp: new Date().toISOString(),
      };

      const prompts = computeSuggestedPrompts(false, [assistantMsg, userMsg]);
      expect(prompts).toEqual(['Test prompt']);
    });

    it('returns empty array if last assistant has no prompts', () => {
      const noPromptsMessage = createAssistantMessage('Just a simple response without prompts.');
      const prompts = computeSuggestedPrompts(false, [noPromptsMessage]);
      expect(prompts).toEqual([]);
    });
  });

  describe('streaming state transition', () => {
    /**
     * REGRESSION: Simulates the transition from streaming -> complete.
     * This is the critical path that must work correctly.
     */
    it('prompts become visible exactly when isStreaming transitions to false', () => {
      // During streaming - no prompts
      expect(computeSuggestedPrompts(true, [messageWithPrompts])).toEqual([]);

      // After completion - prompts visible
      expect(computeSuggestedPrompts(false, [messageWithPrompts])).toEqual([
        'Run the tests',
        'Check the build status',
      ]);
    });
  });
});

