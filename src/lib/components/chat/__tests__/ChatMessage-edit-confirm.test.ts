/**
 * @vitest-environment jsdom
 *
 * Confirm-gate coverage for edit-and-regenerate: saving an edited user message
 * must NOT call `onEditSubmit` until the destructive-truncation confirmation
 * dialog is confirmed; cancelling keeps edit mode open with the draft intact.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '$shared/types';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

// Mock Redux store and selectors (same seams as the sibling ChatMessage tests).
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

// Stub the edit-mode input; the mock exposes submit/cancel buttons that call
// the real `onsubmit`/`oncancel` callbacks ChatMessage wires up.
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/MockSimpleRichInput.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';

function userMessage(): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'original text' }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
  };
}

/** Render, enter edit mode, and press save — the confirm dialog should open. */
async function renderAndSave(onEditSubmit: (text: string, model?: string) => void) {
  render(ChatMessage, { props: { message: userMessage(), onEditSubmit } });

  // Click the message body to enter edit mode.
  await fireEvent.click(screen.getByText('original text'));
  await waitFor(() => expect(screen.getByTestId('mock-rich-input')).toBeTruthy());

  // Save the edit — this must open the confirmation dialog, not submit.
  await fireEvent.click(screen.getByTestId('mock-input-submit'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
}

describe('ChatMessage edit-and-regenerate confirm gate', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
  });

  it('does not call onEditSubmit until the confirmation is accepted', async () => {
    const onEditSubmit = vi.fn();
    await renderAndSave(onEditSubmit);

    expect(onEditSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Edit message and restart from here?')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Edit & regenerate' }));

    await waitFor(() => expect(onEditSubmit).toHaveBeenCalledWith('original text', undefined));
    // Confirming closes both the dialog and edit mode (the edit input exits
    // via a slide transition, so wait for its removal).
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('mock-rich-input')).toBeNull());
  });

  it('cancel keeps edit mode open with the draft intact and never submits', async () => {
    const onEditSubmit = vi.fn();
    await renderAndSave(onEditSubmit);

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onEditSubmit).not.toHaveBeenCalled();
    // Edit mode (the mock input) is still mounted with the draft value.
    const input = screen.getByTestId('mock-rich-input');
    expect(input.getAttribute('data-value')).toBe('original text');
  });
});
