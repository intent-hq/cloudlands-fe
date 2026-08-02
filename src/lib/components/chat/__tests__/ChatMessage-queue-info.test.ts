/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
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

// PROTOCOL.md §5.5 dequeue-wait annotation, exactly as intentd appends it.
const WAIT_NOTE =
  '[SYSTEM NOTE] This message was queued at 2026-01-01T11:58:00Z and waited 2m 0s before delivery.';
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
  it('renders the chip and hides the [SYSTEM NOTE] line when queueInfo metadata is present', () => {
    const { container } = render(ChatMessage, {
      props: { message: userMessage(ANNOTATED_TEXT, QUEUE_INFO_METADATA) },
    });

    const chip = screen.getByTestId('queued-message-notice');
    expect(chip.textContent).toContain('waited');
    expect(chip.textContent).toContain('before delivery');
    // Body keeps the message text but not the raw note
    expect(screen.getByText('hello queued world')).toBeTruthy();
    expect(container.textContent).not.toContain('[SYSTEM NOTE]');
  });

  it('renders old transcripts (raw note, no metadata) unchanged with no chip', () => {
    const { container } = render(ChatMessage, {
      props: { message: userMessage(ANNOTATED_TEXT) },
    });

    expect(screen.queryByTestId('queued-message-notice')).toBeNull();
    expect(container.textContent).toContain(WAIT_NOTE);
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
    expect(container.textContent).toContain(WAIT_NOTE);
  });

  it('coexists with the agent-to-agent attribution chip', () => {
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
    expect(screen.getByTestId('queued-message-notice')).toBeTruthy();
    expect(screen.getByText('hello queued world')).toBeTruthy();
  });
});
