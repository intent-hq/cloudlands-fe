/**
 * @vitest-environment jsdom
 *
 * Tests for ReplaceAgentModal (peer-agent hand-off).
 *
 * Covers the user-visible contract: the modal opens pre-filled with the
 * built hand-off instruction, Send delivers the CURRENT (possibly edited)
 * textarea text exactly once and closes the modal, and every dismissal path
 * (Cancel button, Escape) never invokes onSend.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { buildReplaceAgentHandoffMessage } from '$shared/utils/replace-agent-handoff';
import { warmImport } from '../../../../test/warm-import';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../ReplaceAgentModal.svelte'));

async function renderModal(props: Record<string, unknown> = {}) {
  const ReplaceAgentModal = (await import('../ReplaceAgentModal.svelte')).default;
  return render(ReplaceAgentModal, {
    props: {
      open: true,
      agentName: 'Backend Coordinator',
      specialist: 'implementor',
      ...props,
    },
  });
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox', {
    name: m.modals_replaceAgent_instruction_ariaLabel(),
  }) as HTMLTextAreaElement;
}

describe('ReplaceAgentModal', () => {
  it('pre-fills the textarea with the built hand-off instruction', async () => {
    await renderModal();

    expect(await screen.findByRole('dialog', { name: m.modals_replaceAgent_title() })).toBeTruthy();
    expect(getTextarea().value).toBe(
      buildReplaceAgentHandoffMessage({
        agentName: 'Backend Coordinator',
        specialist: 'implementor',
      }),
    );
  });

  it('sends the edited text exactly once and closes the modal', async () => {
    const onSend = vi.fn();
    await renderModal({ onSend });

    await screen.findByRole('dialog', { name: m.modals_replaceAgent_title() });
    const edited = 'Custom hand-off: wrap up and retire.';
    await fireEvent.input(getTextarea(), { target: { value: edited } });

    await fireEvent.click(screen.getByRole('button', { name: m.modals_replaceAgent_send_label() }));

    expect(onSend).toHaveBeenCalledExactlyOnceWith(edited);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('disables Send while the textarea is blank and never sends blank text', async () => {
    const onSend = vi.fn();
    await renderModal({ onSend });

    await screen.findByRole('dialog', { name: m.modals_replaceAgent_title() });
    await fireEvent.input(getTextarea(), { target: { value: '   ' } });

    const sendButton = screen.getByRole('button', {
      name: m.modals_replaceAgent_send_label(),
    }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    await fireEvent.click(sendButton);

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Cancel closes the modal without sending, even after edits', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    await renderModal({ onSend, onCancel });

    await screen.findByRole('dialog', { name: m.modals_replaceAgent_title() });
    await fireEvent.input(getTextarea(), { target: { value: 'edited but abandoned' } });

    await fireEvent.click(
      screen.getByRole('button', { name: m.modals_replaceAgent_cancel_label() }),
    );

    expect(onSend).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Escape closes the modal without sending', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    await renderModal({ onSend, onCancel });

    const dialog = await screen.findByRole('dialog', { name: m.modals_replaceAgent_title() });
    await fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onSend).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
