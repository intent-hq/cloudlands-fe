/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AgentMessageList from '../AgentMessageList.svelte';
import { getAutoUnarchivedNotice } from '../auto-unarchived-notice';
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

// Persisted wire shape: role "system", one text block, row metadata
// { type: "auto_unarchived", reason: "agent_activity" }.
const AUTO_UNARCHIVED_METADATA = {
  type: 'auto_unarchived',
  reason: 'agent_activity',
};

const AUTO_UNARCHIVED_TEXT =
  'Workspace was automatically unarchived because a message was sent to this agent.';

function autoUnarchivedMessage(): AgentMessage {
  return {
    id: 'msg-1',
    role: 'system',
    contentBlocks: [{ type: 'text', text: AUTO_UNARCHIVED_TEXT }],
    timestamp: new Date().toISOString(),
    metadata: AUTO_UNARCHIVED_METADATA as AgentMessage['metadata'],
  };
}

describe('getAutoUnarchivedNotice', () => {
  it('detects the notice from the row metadata', () => {
    expect(getAutoUnarchivedNotice({ role: 'system', metadata: AUTO_UNARCHIVED_METADATA })).toEqual(
      { reason: 'agent_activity' },
    );
  });

  it('returns null for other messages and malformed metadata', () => {
    expect(getAutoUnarchivedNotice(null)).toBeNull();
    expect(getAutoUnarchivedNotice(undefined)).toBeNull();
    expect(getAutoUnarchivedNotice({})).toBeNull();
    expect(getAutoUnarchivedNotice({ role: 'system' })).toBeNull();
    expect(getAutoUnarchivedNotice({ role: 'system', metadata: { type: 'other' } })).toBeNull();
    expect(getAutoUnarchivedNotice({ role: 'system', metadata: { type: 'model_changed' } })).toBeNull();
  });

  it('tolerates a missing or malformed reason', () => {
    expect(getAutoUnarchivedNotice({ metadata: { type: 'auto_unarchived' } })).toEqual({
      reason: undefined,
    });
    expect(getAutoUnarchivedNotice({ metadata: { type: 'auto_unarchived', reason: 42 } })).toEqual({
      reason: undefined,
    });
  });
});

describe('AgentMessageList - auto-unarchived divider', () => {
  it('renders the persisted system row as a centered divider, not an interruption alert', () => {
    const { container } = render(AgentMessageList, {
      props: { messages: [autoUnarchivedMessage()] },
    });

    // Subtle centered divider, discriminated on metadata before role branching
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(m.chat_autoUnarchivedNotice_unarchived_label())).toBeTruthy();
    expect(container.querySelector('.auto-unarchived-notice')).toBeTruthy();

    // The persisted contract text stays out of the visible transcript body
    expect(screen.queryByText(AUTO_UNARCHIVED_TEXT)).toBeNull();
  });

  it('leaves system rows without auto_unarchived metadata on the existing path', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'This conversation was interrupted.' }],
        timestamp: new Date().toISOString(),
      },
    ];

    const { container } = render(AgentMessageList, { props: { messages } });

    // Unknown metadata falls through to the interruption banner unchanged
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/This conversation was interrupted/i)).toBeTruthy();
    expect(container.querySelector('.auto-unarchived-notice')).toBeNull();
  });
});
