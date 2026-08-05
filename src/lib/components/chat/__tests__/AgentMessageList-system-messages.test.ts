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

  it('renders a model_changed system message as a centered model-change notice', () => {
    // Daemon-persisted notice row shape (PROTOCOL.md §5.5, agent.setModel):
    // role "system", one text-block fallback, metadata
    // { type: "model_changed", from, to, fromProvider, toProvider }.
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [
          { type: 'text', text: 'Model changed from auggie:sonnet4.6 to codex:gpt-5-codex.' },
        ],
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'model_changed',
          from: 'sonnet4.6',
          to: 'gpt-5-codex',
          fromProvider: 'auggie',
          toProvider: 'codex',
        },
      },
    ];

    render(AgentMessageList, { props: { messages } });

    // Rendered as a status divider, not an interruption alert. Each side is
    // "<PrettyName> (<providerId> / <modelId>)"; with the empty mocked store
    // the pretty name falls back to the raw model id.
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByText(
        'Switched from sonnet4.6 (auggie / sonnet4.6) to gpt-5-codex (codex / gpt-5-codex)',
      ),
    ).toBeTruthy();
  });

  it('renders "default model" when model_changed from/to are null (provider default)', () => {
    // from/to are null when the spawn resolved no explicit model id.
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [
          { type: 'text', text: 'Model changed from auggie (default model) to codex:gpt-5-codex.' },
        ],
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'model_changed',
          from: null,
          to: 'gpt-5-codex',
          fromProvider: 'auggie',
          toProvider: 'codex',
        },
      },
    ];

    render(AgentMessageList, { props: { messages } });

    expect(screen.getByRole('status')).toBeTruthy();
    expect(
      screen.getByText(
        'Switched from auggie default model (auggie) to gpt-5-codex (codex / gpt-5-codex)',
      ),
    ).toBeTruthy();
  });

  it('renders no model-change notice when the transcript has no model_changed row', () => {
    // A reverted-before-send switch persists nothing, so an ordinary
    // transcript must contain no status divider.
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Hello' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-2',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Response' }],
        timestamp: new Date().toISOString(),
      },
    ];

    render(AgentMessageList, { props: { messages } });

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders a discussion-request system message as a discussion notice with the reason', () => {
    // Wire shape (agent attention requests): system role, text block with
    // meta.kind = "discussion-request" carrying the reason.
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [
          { type: 'text', text: 'Need input on the API design', meta: { kind: 'discussion-request' } },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const { container } = render(AgentMessageList, { props: { messages } });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Discussion requested/i)).toBeTruthy();
    expect(screen.getByText('Need input on the API design')).toBeTruthy();
    expect(container.querySelector('.discussion-request-notice')).toBeTruthy();
    expect(container.querySelector('.interruption-notice')).toBeNull();
  });

  it('renders a blocker-report system message as a blocker notice with the reason', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [
          { type: 'text', text: 'Docker daemon is down', meta: { kind: 'blocker-report' } },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const { container } = render(AgentMessageList, { props: { messages } });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Blocker reported/i)).toBeTruthy();
    expect(screen.getByText('Docker daemon is down')).toBeTruthy();
    expect(container.querySelector('.blocker-report-notice')).toBeTruthy();
    expect(container.querySelector('.interruption-notice')).toBeNull();
  });

  it('still renders meta.kind="interruption" system messages as interruption notices', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [
          {
            type: 'text',
            text: 'This conversation was interrupted because intentd restarted.',
            meta: { kind: 'interruption' },
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const { container } = render(AgentMessageList, { props: { messages } });

    expect(container.querySelector('.interruption-notice')).toBeTruthy();
    expect(container.querySelector('.discussion-request-notice')).toBeNull();
    expect(container.querySelector('.blocker-report-notice')).toBeNull();
  });

  it('falls back to the message text when model_changed metadata fields are missing', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'Model changed to gpt-5-codex' }],
        timestamp: new Date().toISOString(),
        metadata: { type: 'model_changed' },
      },
    ];

    render(AgentMessageList, { props: { messages } });

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/Model changed to gpt-5-codex/)).toBeTruthy();
  });
});
