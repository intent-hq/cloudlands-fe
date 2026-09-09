/**
 * @vitest-environment jsdom
 *
 * Confirm-gate coverage for edit-and-regenerate: saving an edited user message
 * must NOT call `onEditSubmit` until the destructive-truncation confirmation
 * dialog is confirmed; cancelling keeps edit mode open with the draft intact.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { createMockWorkspace } from '../../../../test/factories/workspace.factory';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

// Mock Redux store and selectors (same seams as the sibling ChatMessage tests).
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
}));

// Stub the edit-mode input; the mock exposes submit/cancel buttons that call
// the real `onsubmit`/`oncancel` callbacks ChatMessage wires up.
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/MockSimpleRichInput.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';
import { evictAttachmentImageUrl, resolveAttachmentImageUrl } from '../attachment-image-url';

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
  const rendered = render(ChatMessage, { props: { message: userMessage(), onEditSubmit } });

  // Click the message body to enter edit mode.
  await fireEvent.click(screen.getByText('original text'));
  await waitFor(() => expect(screen.getByTestId('mock-rich-input')).toBeTruthy());

  // Save the edit — this must open the confirmation dialog, not submit.
  await fireEvent.click(screen.getByTestId('mock-input-submit'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

  return rendered;
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

    await waitFor(() =>
      expect(onEditSubmit).toHaveBeenCalledWith('original text', undefined, undefined),
    );
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

  it('renders the dialog portaled to the document body, not inline in the message', async () => {
    const { container } = await renderAndSave(vi.fn());

    const dialog = screen.getByRole('dialog');
    // Portaled out of the ChatMessage subtree (where ancestor overflow/
    // transforms clip the fixed overlay) into the body-level portal root.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    // Full overlay modal with both actions visible.
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: 'Edit & regenerate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    // Destructive confirmation receives initial focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Edit & regenerate' }),
      ),
    );
  });

  it('Escape cancels back to edit mode with the draft intact', async () => {
    const onEditSubmit = vi.fn();
    await renderAndSave(onEditSubmit);

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onEditSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('original text');
  });

  it('close affordance cancels back to edit mode with the draft intact', async () => {
    const onEditSubmit = vi.fn();
    await renderAndSave(onEditSubmit);

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onEditSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('original text');
  });

  it('confirm threads attachment blocks (image + attachment-reference file) through onEditSubmit', async () => {
    // Message carrying both an image block and an attachment-reference file
    // block (PROTOCOL §5.5/§6.12): the edit restores them as context items
    // and confirming must rebuild + forward BOTH block kinds — attachments
    // survive edit/regenerate rather than being dropped to text+model.
    const message: AgentMessage = {
      id: 'msg-blocks',
      role: 'user',
      contentBlocks: [
        { type: 'text', text: 'original text' },
        { type: 'image', data: 'aW1n', mimeType: 'image/png' },
        {
          type: 'file',
          attachmentId: 'att-uuid-9',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          size: 4096,
        },
      ],
      timestamp: new Date('2026-01-01T12:00:00Z'),
    } as AgentMessage;
    const onEditSubmit = vi.fn();
    render(ChatMessage, { props: { message, onEditSubmit } });

    await fireEvent.click(screen.getByText('original text'));
    await waitFor(() => expect(screen.getByTestId('mock-rich-input')).toBeTruthy());
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Edit & regenerate' }));

    await waitFor(() =>
      expect(onEditSubmit).toHaveBeenCalledWith('original text', undefined, {
        imageBlocks: [{ type: 'image', data: 'aW1n', mimeType: 'image/png' }],
        fileBlocks: [
          {
            type: 'file',
            attachmentId: 'att-uuid-9',
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            size: 4096,
          },
        ],
      }),
    );
  });

  it('confirm passes no blocks argument for a plain text message', async () => {
    const onEditSubmit = vi.fn();
    await renderAndSave(onEditSubmit);

    await fireEvent.click(screen.getByRole('button', { name: 'Edit & regenerate' }));

    await waitFor(() =>
      expect(onEditSubmit).toHaveBeenCalledWith('original text', undefined, undefined),
    );
  });
});

describe('ChatMessage attachment-reference thumbnails', () => {
  const originalInvoke = window.electronAPI!.invoke;
  const workspace = createMockWorkspace({ id: WorkspaceId('ws-thumb') });

  // PROTOCOL §5.9 `file.getAttachmentInfo` result for the referenced row.
  const attachmentInfo = {
    attachmentId: 'att-thumb-1',
    fileName: 'shot.png',
    mimeType: 'image/png',
    size: 1234,
    uploadedAt: '2026-01-01T12:00:00Z',
    path: '.intent/attachments/att-thumb-1/shot.png',
    exists: true,
  };

  function referenceMessage(): AgentMessage {
    return {
      id: 'msg-thumb',
      role: 'user',
      contentBlocks: [
        { type: 'text', text: 'see attached' },
        { type: 'image', attachmentId: 'att-thumb-1', mimeType: 'image/png' },
      ],
      timestamp: new Date('2026-01-01T12:00:00Z'),
    } as AgentMessage;
  }

  beforeEach(() => {
    resetMockIpcRouter();
    window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
      mockInvoke(channel, payload),
    );
  });
  afterEach(() => {
    window.electronAPI!.invoke = originalInvoke;
    resetMockIpcRouter();
  });

  it('falls back to the placeholder tile and evicts the cached URL when the thumbnail fails to load', async () => {
    const getAttachmentInfo = vi.fn(() => ({ ok: true, result: attachmentInfo }));
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
      expect(payload).toEqual({
        method: 'file.getAttachmentInfo',
        params: { attachmentId: 'att-thumb-1' },
      });
      return getAttachmentInfo();
    });

    render(ChatMessage, { props: { message: referenceMessage(), workspace } });

    // The reference resolves to a workspace-file:// URL and renders as <img>.
    const img = await screen.findByRole('img', { name: /attached image/i });
    const url = 'workspace-file://ws-thumb/.intent/attachments/att-thumb-1/shot.png';
    expect(img.getAttribute('src')).toBe(url);
    expect(getAttachmentInfo).toHaveBeenCalledTimes(1);
    // The module cache serves the same URL without another wire round-trip.
    await expect(resolveAttachmentImageUrl('ws-thumb', 'att-thumb-1')).resolves.toBe(url);
    expect(getAttachmentInfo).toHaveBeenCalledTimes(1);

    // The protocol handler refused the bytes (e.g. 404): the <img> errors.
    await fireEvent.error(img);

    await waitFor(() => expect(screen.getByTestId('chat-message-image-placeholder')).toBeTruthy());
    expect(screen.queryByRole('img', { name: /attached image/i })).toBeNull();
    // Evicted: the next resolve re-issues file.getAttachmentInfo instead of
    // replaying the URL that just failed — and this instance does not loop.
    await expect(resolveAttachmentImageUrl('ws-thumb', 'att-thumb-1')).resolves.toBe(url);
    expect(getAttachmentInfo).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('chat-message-image-placeholder')).toBeTruthy();
  });

  it('re-resolves a failed thumbnail once the backend reconnects', async () => {
    const getAttachmentInfo = vi.fn(() => ({ ok: true, result: attachmentInfo }));
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, () => getAttachmentInfo());
    const statusHandlers: Array<(payload: unknown) => void> = (
      window.electronAPI as any
    )._getRegisteredHandlers(IPC_CHANNELS.BACKEND.STATUS);
    statusHandlers.length = 0;
    // Start from an empty module cache (the previous test re-cached the URL).
    evictAttachmentImageUrl('ws-thumb', 'att-thumb-1');

    render(ChatMessage, { props: { message: referenceMessage(), workspace } });

    const img = await screen.findByRole('img', { name: /attached image/i });
    expect(getAttachmentInfo).toHaveBeenCalledTimes(1);

    // The owning backend dropped: the hinted read fails closed and the
    // thumbnail parks on the placeholder without a resolve/fail loop.
    await fireEvent.error(img);
    await waitFor(() => expect(screen.getByTestId('chat-message-image-placeholder')).toBeTruthy());
    expect(getAttachmentInfo).toHaveBeenCalledTimes(1);

    // A plain (non-reconnect) status broadcast changes nothing.
    for (const handler of [...statusHandlers]) handler({ status: 'connected' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getAttachmentInfo).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-message-image-placeholder')).toBeTruthy();

    // The `reconnected` marker (backend.ipc.ts RESUB-1) clears the failure:
    // the still-mounted message re-resolves and renders the thumbnail again.
    for (const handler of [...statusHandlers]) handler({ status: 'connected', reconnected: true });
    const restored = await screen.findByRole('img', { name: /attached image/i });
    expect(restored.getAttribute('src')).toBe(
      'workspace-file://ws-thumb/.intent/attachments/att-thumb-1/shot.png',
    );
    expect(getAttachmentInfo).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('chat-message-image-placeholder')).toBeNull();
  });
});

describe('ChatMessage model-change notice row', () => {
  function modelChangedMessage(): AgentMessage {
    // Daemon-persisted notice row shape (PROTOCOL.md §5.5, agent.setModel).
    return {
      id: 'msg-mc',
      role: 'system',
      contentBlocks: [
        { type: 'text', text: 'Model changed from auggie:gpt5.4 to codex:gpt-5-codex.' },
      ],
      timestamp: new Date('2026-01-01T12:00:00Z'),
      metadata: {
        type: 'model_changed',
        from: 'gpt5.4',
        to: 'gpt-5-codex',
        fromProvider: 'auggie',
        toProvider: 'codex',
      },
    } as AgentMessage;
  }

  it('renders as an inline status divider, not a message bubble', () => {
    const { container } = render(ChatMessage, { props: { message: modelChangedMessage() } });

    expect(screen.getByRole('status')).toBeTruthy();
    // No bubble wrapper: the notice replaces the message chrome entirely.
    expect(container.querySelector('[data-message-role]')).toBeNull();
    expect(container.querySelector('.user-message')).toBeNull();
    expect(container.querySelector('.assistant-message')).toBeNull();
  });

  it('is not editable or regeneratable even when onEditSubmit is wired', async () => {
    const onEditSubmit = vi.fn();
    render(ChatMessage, { props: { message: modelChangedMessage(), onEditSubmit } });

    const notice = screen.getByRole('status');
    await fireEvent.click(notice);
    await fireEvent.dblClick(notice);

    // Neither edit mode nor the regenerate confirm dialog can open.
    expect(screen.queryByTestId('mock-rich-input')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onEditSubmit).not.toHaveBeenCalled();
  });
});

describe('ChatMessage attention-request notice rows', () => {
  // Wire shape (agent attention requests): system-role message, text block
  // with meta.kind = "discussion-request" / "blocker-report" carrying the reason.
  function attentionMessage(kind: string, reason: string): AgentMessage {
    return {
      id: 'msg-att',
      role: 'system',
      contentBlocks: [{ type: 'text', text: reason, meta: { kind } }],
      timestamp: new Date('2026-01-01T12:00:00Z'),
    } as AgentMessage;
  }

  it('renders a discussion-request row as a discussion notice with the reason', () => {
    const { container } = render(ChatMessage, {
      props: { message: attentionMessage('discussion-request', 'Need input on the API design') },
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Discussion requested/i)).toBeTruthy();
    expect(screen.getByText('Need input on the API design')).toBeTruthy();
    expect(container.querySelector('.discussion-request-notice')).toBeTruthy();
    expect(container.querySelector('.interruption-notice')).toBeNull();
  });

  it('renders a blocker-report row as a blocker notice with the reason', () => {
    const { container } = render(ChatMessage, {
      props: { message: attentionMessage('blocker-report', 'Docker daemon is down') },
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Blocker reported/i)).toBeTruthy();
    expect(screen.getByText('Docker daemon is down')).toBeTruthy();
    expect(container.querySelector('.blocker-report-notice')).toBeTruthy();
    expect(container.querySelector('.interruption-notice')).toBeNull();
  });

  it('keeps rendering other system rows as interruption notices', () => {
    const message: AgentMessage = {
      id: 'msg-int',
      role: 'system',
      contentBlocks: [
        {
          type: 'text',
          text: 'This conversation was interrupted because intentd restarted.',
          meta: { kind: 'interruption' },
        },
      ],
      timestamp: new Date('2026-01-01T12:00:00Z'),
    } as AgentMessage;

    const { container } = render(ChatMessage, { props: { message } });

    expect(container.querySelector('.interruption-notice')).toBeTruthy();
    expect(container.querySelector('.discussion-request-notice')).toBeNull();
    expect(container.querySelector('.blocker-report-notice')).toBeNull();
  });
});
