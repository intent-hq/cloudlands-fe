/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

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
  selectAgentSession: () => ({
    subscribe: (run: (value: undefined) => void) => {
      run(undefined);
      return () => {};
    },
  }),
  selectAgentIsResponding: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(false);
      return () => {};
    },
  }),
  selectAgentIsWaiting: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(false);
      return () => {};
    },
  }),
  selectAgentProvider: () => ({
    subscribe: (run: (value: undefined) => void) => {
      run(undefined);
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => ({
    subscribe: (run: (value: number) => void) => {
      run(0);
      return () => {};
    },
  }),
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/AgentAvatar.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/AgentMessageAttributionAvatar.svelte')).default,
}));

// Stub the edit-mode input; its real dependency tree (ModelPicker → useAgentSession)
// needs live store context that these rendering tests don't exercise.
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';

// PROTOCOL.md §5.5 dequeue-wait annotation, exactly as intentd appends it.
const WAIT_NOTE =
  '[SYSTEM NOTE] This message was queued at 2026-01-01T11:58:00Z and waited 2m 0s before delivery.';
const STALE_NOTE =
  '[SYSTEM NOTE] This message was queued before you completed; your completion report was already delivered to your parent at 2026-01-01T11:59:00Z. Only call reportToParent again if this message materially changes the outcome — do not re-send the same report.';
const ANNOTATED_TEXT = `hello queued world\n\n${WAIT_NOTE}`;

// PROTOCOL-shaped metadata stamped by intentd on drained queue entries.
const QUEUE_INFO_METADATA = {
  queueInfo: { queuedAt: '2026-01-01T11:58:00Z', waitedMs: 120000 },
};

function userMessage(text: string, metadata?: Record<string, unknown>): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
    ...(metadata ? { metadata } : {}),
  };
}

describe('ChatMessage queued-delivery notice', () => {
  it('renders only the queue wait duration and hides the [SYSTEM NOTE] line', () => {
    const { container, unmount } = render(ChatMessage, {
      props: { message: userMessage(ANNOTATED_TEXT, QUEUE_INFO_METADATA) },
    });

    const chip = screen.getByTestId('queued-message-notice');
    const copy = screen.getByTestId('queued-message-notice-text');
    expect(copy.textContent).toBe('Waited in queue for 2m');
    expect(copy.textContent).not.toContain('Queued at');
    expect(copy.textContent).not.toContain('before delivery');
    expect(chip.getAttribute('title')).toBeTruthy();
    expect(chip.className).toContain('text-subtle');
    expect(chip.className).toContain('mb-1.5');
    // Body keeps the message text but not the raw note
    expect(screen.getByText('hello queued world')).toBeTruthy();
    expect(container.textContent).not.toContain('[SYSTEM NOTE]');
    unmount();
  });

  it('hides a trailing note block while preserving attachments and stored blocks', () => {
    const message = userMessage('attachment body', QUEUE_INFO_METADATA);
    message.contentBlocks = [
      { type: 'text', text: 'attachment body' },
      {
        type: 'file',
        attachmentId: 'attachment-1',
        fileName: 'proof.txt',
        mimeType: 'text/plain',
      },
      { type: 'text', text: WAIT_NOTE },
    ];
    const stored = structuredClone(message);

    const { container } = render(ChatMessage, { props: { message } });

    expect(screen.getByText('attachment body')).toBeTruthy();
    expect(screen.getByText('proof.txt')).toBeTruthy();
    expect(container.textContent).not.toContain('[SYSTEM NOTE]');
    expect(message).toEqual(stored);
  });

  it.each([
    [1000, 'Waited in queue for 1s'],
    [7400, 'Waited in queue for 7s'],
    [90_000, 'Waited in queue for 1m 30s'],
  ])('formats a %ims delay as localized copy', (waitedMs, expected) => {
    render(ChatMessage, {
      props: {
        message: userMessage('queued body', {
          queueInfo: { queuedAt: '2026-01-01T11:58:00Z', waitedMs },
        }),
      },
    });

    expect(screen.getByTestId('queued-message-notice-text').textContent).toBe(expected);
  });

  it('suppresses a delay that rounds to zero while still hiding the raw note', () => {
    const { container } = render(ChatMessage, {
      props: {
        message: userMessage(ANNOTATED_TEXT, {
          queueInfo: { queuedAt: '2026-01-01T11:58:00Z', waitedMs: 0 },
        }),
      },
    });

    expect(screen.queryByTestId('queued-message-notice')).toBeNull();
    expect(container.textContent).not.toContain('[SYSTEM NOTE]');
    expect(screen.getByText('hello queued world')).toBeTruthy();
  });

  it('truncates the queued notice to one line only while sticky', async () => {
    const { rerender } = render(ChatMessage, {
      props: {
        message: userMessage(ANNOTATED_TEXT, QUEUE_INFO_METADATA),
        isSticky: false,
      },
    });

    const notice = screen.getByTestId('queued-message-notice');
    const text = screen.getByTestId('queued-message-notice-text');
    expect(notice.className).not.toContain('overflow-hidden');
    expect(text.className).not.toContain('truncate');

    await rerender({
      message: userMessage(ANNOTATED_TEXT, QUEUE_INFO_METADATA),
      isSticky: true,
    });

    expect(notice.className).toContain('overflow-hidden');
    expect(text.className).toContain('truncate');
  });

  it('hides exact legacy trailing notes without adding a queue chip', () => {
    const { container } = render(ChatMessage, {
      props: { message: userMessage(`legacy body\n\n${STALE_NOTE}\n\n${WAIT_NOTE}`) },
    });

    expect(screen.queryByTestId('queued-message-notice')).toBeNull();
    expect(container.textContent).toContain('legacy body');
    expect(container.textContent).not.toContain('[SYSTEM NOTE]');
  });

  it('renders a plain user message without the chip', () => {
    render(ChatMessage, { props: { message: userMessage('plain message') } });

    expect(screen.queryByTestId('queued-message-notice')).toBeNull();
    expect(screen.getByText('plain message')).toBeTruthy();
  });

  it('ignores malformed queueInfo metadata (missing waitedMs)', () => {
    const { container } = render(ChatMessage, {
      props: {
        message: userMessage(ANNOTATED_TEXT, {
          queueInfo: { queuedAt: '2026-01-01T11:58:00Z' },
        }),
      },
    });

    expect(screen.queryByTestId('queued-message-notice')).toBeNull();
    expect(container.textContent).not.toContain(WAIT_NOTE);
    expect(container.textContent).toContain('hello queued world');
  });

  it('coexists with the agent-to-agent attribution chip', async () => {
    render(ChatMessage, {
      props: {
        message: userMessage(ANNOTATED_TEXT, {
          type: 'agent_message',
          fromAgentId: 'agent-sender-1',
          fromAgentName: 'Builder',
          ...QUEUE_INFO_METADATA,
        }),
      },
    });

    expect(screen.getByTestId('agent-message-attribution')).toBeTruthy();
    expect(screen.queryByTestId('queued-message-notice')).toBeNull();
    await fireEvent.click(screen.getByTestId('agent-message-disclosure-toggle'));
    const chip = screen.getByTestId('queued-message-notice');
    expect(chip.className).toContain('text-subtle');
    expect(screen.getByText('hello queued world')).toBeTruthy();
  });
});
