/**
 * Regression tests for suggested prompts visibility.
 *
 * These tests verify that suggested prompts are only visible once the agent is
 * idle. The visibility logic in ChatPanel.svelte returns an empty array whenever
 * the canonical `selectAgentIsRunning` selector reports the agent as running —
 * which is broader than streaming (it also covers processing, executing tools,
 * activating, and waiting on other agents).
 *
 * This regression coverage ensures that:
 * 1. Prompts are hidden while the agent is running (streaming OR not streaming)
 * 2. Prompts become visible once the agent is idle (isRunning = false)
 * 3. The derived computation correctly extracts prompts from the last assistant message
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { parseSuggestedPrompts } from '$lib/utils/messageParser';
import { derivePendingQuestions } from '../questions/pending-questions';
import { buildAnswerMessageMetadata } from '../questions/answer-message';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import type { AgentMessage, ContentBlock } from '$shared/types';
import type { SuggestedPrompt } from '$shared/types';

/**
 * Simulates the suggestedPrompts derived computation from ChatPanel.svelte
 * This is the exact logic used to determine visibility.
 *
 * `isRunning` mirrors the canonical `selectAgentIsRunning` gate — it is true
 * whenever the agent's turn is active (streaming, processing, executing tools,
 * activating, or waiting on other agents), not only during text streaming.
 */
function computeSuggestedPrompts(
  isRunning: boolean,
  messages: AgentMessage[],
  showingPendingUserMessage = false,
): SuggestedPrompt[] {
  // Mirrors ChatPanel.svelte suggestedPrompts derived gate.
  if (isRunning || messages.length === 0) {
    return [];
  }
  // Hide as soon as the user submits a new prompt: either a trailing user
  // message exists, or an optimistic/pending user bubble is being shown.
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === 'user' || showingPendingUserMessage) {
    return [];
  }
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistantMessage) {
    return [];
  }
  // Suggested prompts stay hidden whenever the turn has pending Agent Q&A
  // questions — including while the wizard is Ignore-collapsed (collapse is
  // transient UI state that does not affect this derivation).
  if (derivePendingQuestions(messages, isRunning, showingPendingUserMessage)) {
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

  describe('visibility gating on isRunning', () => {
    /**
     * REGRESSION: Prompts must NOT be visible while the agent is running.
     * This prevents flickering or premature display of incomplete prompt data.
     */
    it('returns empty array when isRunning is true, even with valid prompts', () => {
      const prompts = computeSuggestedPrompts(true, [messageWithPrompts]);
      expect(prompts).toEqual([]);
    });

    // The running-but-not-streaming edge case (processing, executing tools,
    // activating, waiting on sub-agents) is covered by the selectAgentIsRunning
    // suite in agent-session-slice.test.ts — the real selector this gate consumes.
    // computeSuggestedPrompts collapses every running state into one isRunning
    // boolean, so it cannot meaningfully exercise that path here.

    /**
     * REGRESSION: Once the agent's turn has ended (isRunning = false), prompts become visible.
     */
    it('returns prompts when isRunning is false and prompts exist', () => {
      const prompts = computeSuggestedPrompts(false, [messageWithPrompts]);
      expect(prompts).toEqual(['Run the tests', 'Check the build status']);
    });

    it('returns empty array for empty message list regardless of running state', () => {
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

    it('hides prompts when a user message trails the last assistant message', () => {
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
      expect(prompts).toEqual([]);
    });

    it('returns empty array if last assistant has no prompts', () => {
      const noPromptsMessage = createAssistantMessage('Just a simple response without prompts.');
      const prompts = computeSuggestedPrompts(false, [noPromptsMessage]);
      expect(prompts).toEqual([]);
    });
  });

  describe('hiding once the user submits a new prompt', () => {
    const userMsg: AgentMessage = {
      id: 'msg_user_1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'A new user prompt' }],
      timestamp: new Date().toISOString(),
    };

    /**
     * REGRESSION: When the last message in the thread is a user message, the
     * prompts from the preceding assistant message must be hidden even before
     * `agentIsRunning$` flips true.
     */
    it('returns empty array when the last message is a user message', () => {
      const prompts = computeSuggestedPrompts(false, [messageWithPrompts, userMsg]);
      expect(prompts).toEqual([]);
    });

    /**
     * REGRESSION: An optimistic/pending user bubble (shown before the echo
     * arrives in agentMessages$) must also hide the prompts.
     */
    it('returns empty array when an optimistic pending user message is shown', () => {
      const prompts = computeSuggestedPrompts(false, [messageWithPrompts], true);
      expect(prompts).toEqual([]);
    });
  });

  describe('hiding while Agent Q&A questions are pending', () => {
    const questionBlock: ContentBlock = {
      type: 'resource',
      resource: {
        uri: 'intent-question://tar-abc123def456',
        name: 'Auth method',
        mimeType: QUESTION_RESOURCE_MIME_TYPE,
        text: JSON.stringify({
          attachmentId: 'tar-abc123def456',
          header: 'Auth method',
          question: 'Which authentication method should the new endpoint use?',
          options: [{ label: 'OAuth' }, { label: 'API key' }],
        }),
      },
    } as unknown as ContentBlock;

    const messageWithPromptsAndQuestions: AgentMessage = {
      ...messageWithPrompts,
      contentBlocks: [...(messageWithPrompts.contentBlocks || []), questionBlock],
    };

    /**
     * REGRESSION: Suggested prompts stay hidden whenever the turn has pending
     * questions — including while the wizard is Ignore-collapsed. Collapse is
     * transient component state and never feeds this derivation, so a single
     * assertion covers both expanded and collapsed.
     */
    it('returns empty array when the last assistant message has pending questions', () => {
      const prompts = computeSuggestedPrompts(false, [messageWithPromptsAndQuestions]);
      expect(prompts).toEqual([]);
    });

    it('returns prompts again once the tagged answer message resolves the questions', () => {
      // Pendingness is persistent: only the wizard's answer message —
      // tagged with `question_answers` metadata naming the question-bearing
      // message — resolves the set and brings the prompts back.
      const answerMsg: AgentMessage = {
        id: 'msg_user_answers',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Q: …\nA: OAuth' }],
        timestamp: new Date().toISOString(),
        metadata: buildAnswerMessageMetadata(messageWithPromptsAndQuestions.id),
      } as unknown as AgentMessage;
      const followUp = createAssistantMessage(`Thanks!

<!-- suggested-prompts
Continue
-->
`);
      const prompts = computeSuggestedPrompts(false, [
        messageWithPromptsAndQuestions,
        answerMsg,
        followUp,
      ]);
      expect(prompts).toEqual(['Continue']);
    });

    it('keeps prompts hidden while a PLAIN user message leaves the questions pending', () => {
      const userMsg: AgentMessage = {
        id: 'msg_user_plain',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'unrelated aside' }],
        timestamp: new Date().toISOString(),
      };
      const followUp = createAssistantMessage(`Thanks!

<!-- suggested-prompts
Continue
-->
`);
      const prompts = computeSuggestedPrompts(false, [
        messageWithPromptsAndQuestions,
        userMsg,
        followUp,
      ]);
      expect(prompts).toEqual([]);
    });
  });

  describe('running state transition', () => {
    /**
     * REGRESSION: Simulates the transition from running -> idle.
     * This is the critical path that must work correctly.
     */
    it('prompts become visible exactly when isRunning transitions to false', () => {
      // While running - no prompts
      expect(computeSuggestedPrompts(true, [messageWithPrompts])).toEqual([]);

      // After the turn ends - prompts visible
      expect(computeSuggestedPrompts(false, [messageWithPrompts])).toEqual([
        'Run the tests',
        'Check the build status',
      ]);
    });
  });
});

