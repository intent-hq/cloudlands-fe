/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '$shared/types';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: Object.assign(
    () => ({
      subscribe: (run: (value: string | null) => void) => {
        run('ws-1');
        return () => {};
      },
    }),
    { select: () => 'ws-1' },
  ),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: any[]) => void) => {
        run([]);
        return () => {};
      },
    }),
    { select: () => [] },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: any) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/AuggieAvatar.svelte')).default,
}));

// Stub the edit-mode input; its real dependency tree (ModelPicker → useAgentSession)
// needs live store context that these rendering tests don't exercise.
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';

function userMessage(metadata?: Record<string, unknown>): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hello from another agent' }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
    ...(metadata ? { metadata } : {}),
  };
}

function userTextMessage(text: string): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
  };
}

describe('ChatMessage user message text rendering', () => {
  it('renders multi-line text with no leading whitespace before the first character', () => {
    const { container } = render(ChatMessage, {
      props: { message: userTextMessage('Q: q1\nA: a1') },
    });

    // The element(s) applying whitespace-pre-wrap must contain exactly the
    // message text — no template whitespace text nodes rendered under pre-wrap.
    const preWrapEls = Array.from(container.querySelectorAll('.whitespace-pre-wrap')).filter(
      (el) => el.textContent?.includes('Q: q1'),
    );
    expect(preWrapEls.length).toBeGreaterThan(0);
    for (const el of preWrapEls) {
      expect(el.textContent).toBe('Q: q1\nA: a1');
    }
  });

  it('preserves internal newlines of the message text', () => {
    const { container } = render(ChatMessage, {
      props: { message: userTextMessage('line one\nline two') },
    });

    const span = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === 'line one\nline two',
    );
    expect(span).toBeTruthy();
    expect(span!.className).toContain('whitespace-pre-wrap');
  });

  it('still renders inline mention chips alongside text segments', () => {
    const { container } = render(ChatMessage, {
      props: { message: userTextMessage('see @note/spec now') },
    });

    // Mention chip renders as a button
    const chip = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('spec'),
    );
    expect(chip).toBeTruthy();

    // Surrounding text segments keep their message-internal whitespace
    const spans = Array.from(container.querySelectorAll('span.whitespace-pre-wrap'));
    expect(spans.some((el) => el.textContent === 'see ')).toBe(true);
    expect(spans.some((el) => el.textContent === ' now')).toBe(true);
  });
});

describe('ChatMessage agent-to-agent sender attribution', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
  });

  it('renders the attribution header for an agent_message user row', () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
      },
    });

    const header = screen.getByTestId('agent-message-attribution');
    expect(header).toBeTruthy();
    expect(screen.getByText('Builder')).toBeTruthy();
    expect(screen.getByText('sent a message')).toBeTruthy();
    const avatar = screen.getByTestId('auggie-avatar');
    expect(avatar.getAttribute('data-agent-id')).toBe('agent-sender-1');
    // Message body still renders
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('dispatches openAgentTabRequested with the sender agent id on click', async () => {
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
      },
    });

    await fireEvent.click(screen.getByTestId('agent-message-attribution'));

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const action = dispatchMock.mock.calls[0][0];
    expect(action.type).toBe('appLayout/openAgentTabRequested');
    expect(action.payload[0]).toBe('ws-1');
    expect(action.payload[1]).toMatchObject({ agentId: 'agent-sender-1' });
  });

  it('falls back to "Agent" when fromAgentName is absent', () => {
    render(ChatMessage, {
      props: {
        message: userMessage({ type: 'agent_message', fromAgentId: 'agent-sender-2' }),
      },
    });

    expect(screen.getByTestId('agent-message-attribution')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('renders a plain user message without the attribution header', () => {
    render(ChatMessage, { props: { message: userMessage() } });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('ignores malformed metadata (missing fromAgentId)', () => {
    render(ChatMessage, {
      props: { message: userMessage({ type: 'agent_message', fromAgentName: 'Builder' }) },
    });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
    expect(screen.getByText('hello from another agent')).toBeTruthy();
  });

  it('ignores non-string fromAgentId', () => {
    render(ChatMessage, {
      props: { message: userMessage({ type: 'agent_message', fromAgentId: 42 }) },
    });

    expect(screen.queryByTestId('agent-message-attribution')).toBeNull();
  });

  it('does not enter edit mode when clicking an attributed message body', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: {
        message: userMessage({
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
        }),
        onEditSubmit,
      },
    });

    await fireEvent.click(screen.getByText('hello from another agent'));

    // Still rendering the message (no edit input swapped in)
    expect(screen.getByText('hello from another agent')).toBeTruthy();
    expect(screen.getByTestId('agent-message-attribution')).toBeTruthy();
  });

  it('keeps click-to-edit for plain user messages', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: { message: userMessage(), onEditSubmit },
    });

    await fireEvent.click(screen.getByText('hello from another agent'));

    // Edit mode replaces the message body view
    expect(screen.queryByText('hello from another agent')).toBeNull();
  });
});

describe('ChatMessage hook wake attribution', () => {
  const hookWakeMetadata = {
    type: 'hook_wake',
    hookId: 'hook-1',
    hookName: 'ci-watch',
    reason: 'dispatched',
  };

  function hookWakeMessage(opts: { rowMetadata?: boolean; blockMetadata?: boolean }): AgentMessage {
    return {
      id: 'msg-1',
      role: 'user',
      contentBlocks: [
        {
          type: 'text',
          text: '[Background hook "ci-watch"] CI is red',
          ...(opts.blockMetadata ? { messageMetadata: hookWakeMetadata } : {}),
        },
      ],
      timestamp: new Date('2026-01-01T12:00:00Z'),
      ...(opts.rowMetadata ? { metadata: hookWakeMetadata } : {}),
    };
  }

  it('renders the hook wake header and strips the prefix (row-level metadata)', () => {
    render(ChatMessage, { props: { message: hookWakeMessage({ rowMetadata: true }) } });

    const header = screen.getByTestId('hook-wake-attribution');
    expect(header).toBeTruthy();
    expect(screen.getByText('ci-watch')).toBeTruthy();
    expect(screen.getByText('woke the agent')).toBeTruthy();
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/\[Background hook/)).toBeNull();
  });

  it('detects hook wake from block-level messageMetadata', () => {
    render(ChatMessage, { props: { message: hookWakeMessage({ blockMetadata: true }) } });

    expect(screen.getByTestId('hook-wake-attribution')).toBeTruthy();
    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.queryByText(/\[Background hook/)).toBeNull();
  });

  it('renders untagged prefixed text unchanged (no metadata, no strip)', () => {
    render(ChatMessage, {
      props: { message: hookWakeMessage({}) },
    });

    expect(screen.queryByTestId('hook-wake-attribution')).toBeNull();
    expect(screen.getByText('[Background hook "ci-watch"] CI is red')).toBeTruthy();
  });

  it('does not enter edit mode when clicking a hook wake message body', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, {
      props: { message: hookWakeMessage({ rowMetadata: true }), onEditSubmit },
    });

    await fireEvent.click(screen.getByText('CI is red'));

    expect(screen.getByText('CI is red')).toBeTruthy();
    expect(screen.getByTestId('hook-wake-attribution')).toBeTruthy();
  });
});
