/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AgentMessageList from '../AgentMessageList.svelte';
import { getQuestionsDismissedNotice } from '../questions-dismissed-notice';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage } from '$shared/types';

// Mock the Redux store to avoid initialization errors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {} });
});

// Mock workspace-notes selectors
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: {
    select: vi.fn(() => []),
  },
}));

// Mock workspace selectors
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: () => ({
    subscribe: (fn: (value: any) => void) => {
      fn(null);
      return () => {};
    },
  }),
}));

// Delivered wire shape (agent.dismissQuestions): user-role row tagged on the
// row's metadata AND the persisted text block's messageMetadata.
const DISMISSAL_METADATA = {
  type: 'questions_dismissed',
  source: 'system',
  dismissedQuestionsMessageId: 'msg-q1',
};

const DISMISSAL_TEXT =
  'User dismissed your 2 questions without answering. Continue with your best judgment.';

function dismissalMessage(): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: DISMISSAL_TEXT, messageMetadata: DISMISSAL_METADATA }],
    timestamp: new Date().toISOString(),
    metadata: DISMISSAL_METADATA as AgentMessage['metadata'],
  };
}

describe('getQuestionsDismissedNotice', () => {
  it('detects the notice from the row metadata', () => {
    expect(getQuestionsDismissedNotice({ metadata: DISMISSAL_METADATA })).toEqual({
      dismissedQuestionsMessageId: 'msg-q1',
    });
  });

  it('falls back to the text block messageMetadata when the row metadata is absent', () => {
    expect(
      getQuestionsDismissedNotice({
        contentBlocks: [
          { type: 'text', text: DISMISSAL_TEXT, messageMetadata: DISMISSAL_METADATA },
        ],
      }),
    ).toEqual({ dismissedQuestionsMessageId: 'msg-q1' });
  });

  it('returns null for other messages and malformed metadata', () => {
    expect(getQuestionsDismissedNotice(null)).toBeNull();
    expect(getQuestionsDismissedNotice({})).toBeNull();
    expect(getQuestionsDismissedNotice({ metadata: { type: 'hook_wake' } })).toBeNull();
    expect(
      getQuestionsDismissedNotice({ contentBlocks: [{ type: 'text', text: 'hi' }] }),
    ).toBeNull();
  });

  it('tolerates a missing dismissedQuestionsMessageId', () => {
    expect(
      getQuestionsDismissedNotice({ metadata: { type: 'questions_dismissed', source: 'system' } }),
    ).toEqual({ dismissedQuestionsMessageId: '' });
  });
});

describe('AgentMessageList - questions-dismissed chip', () => {
  it('renders a delivered dismissal message as the special chip, not a plain bubble', () => {
    const { container } = render(AgentMessageList, {
      props: { messages: [dismissalMessage()] },
    });

    // Compact centered chip, discriminated on metadata before role branching
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(m.chat_questionsDismissedNotice_dismissed_label())).toBeTruthy();
    expect(container.querySelector('.questions-dismissed-notice')).toBeTruthy();

    // The delivered prompt text stays out of the visible transcript body
    expect(screen.queryByText(DISMISSAL_TEXT)).toBeNull();
    // No plain user bubble rendered for this row
    expect(container.querySelector('[data-message-role="user"]')).toBeNull();
  });

  it('renders ordinary user messages as bubbles, unaffected by the chip branch', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Hello there' }],
        timestamp: new Date().toISOString(),
      },
    ];

    const { container } = render(AgentMessageList, { props: { messages } });

    expect(screen.getByText('Hello there')).toBeTruthy();
    expect(container.querySelector('.questions-dismissed-notice')).toBeNull();
  });
});
