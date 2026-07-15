/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AgentMessageList from '../AgentMessageList.svelte';
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

describe('AgentMessageList - System Messages', () => {
  it('renders system message as interruption notice', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Hello' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-2',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'This conversation was interrupted because intentd restarted.' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-3',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Response' }],
        timestamp: new Date().toISOString(),
      },
    ];

    render(AgentMessageList, { props: { messages } });

    // System message should be rendered as an alert (InterruptionNotice)
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/This conversation was interrupted/i)).toBeTruthy();
  });

  it('handles multiple system messages', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'First interruption' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-2',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'Second interruption' }],
        timestamp: new Date().toISOString(),
      },
    ];

    render(AgentMessageList, { props: { messages } });

    // Both system messages should be rendered
    expect(screen.getByText(/First interruption/i)).toBeTruthy();
    expect(screen.getByText(/Second interruption/i)).toBeTruthy();
  });

  it('renders system message in correct position among other messages', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'User message 1' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-2',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Assistant response 1' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-3',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'Interruption notice' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-4',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'User message 2' }],
        timestamp: new Date().toISOString(),
      },
    ];

    const { container } = render(AgentMessageList, { props: { messages } });

    // Verify all messages are rendered
    expect(screen.getByText(/User message 1/i)).toBeTruthy();
    expect(screen.getByText(/Assistant response 1/i)).toBeTruthy();
    expect(screen.getByText(/Interruption notice/i)).toBeTruthy();
    expect(screen.getByText(/User message 2/i)).toBeTruthy();

    // Verify system message has correct styling class
    const systemWrapper = container.querySelector('.system-message');
    expect(systemWrapper).toBeTruthy();
  });

  it('extracts text content from system message content blocks', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    render(AgentMessageList, { props: { messages } });

    // extractAllContent should combine both text blocks
    expect(screen.getByText(/Part 1\. Part 2\./i)).toBeTruthy();
  });
});
