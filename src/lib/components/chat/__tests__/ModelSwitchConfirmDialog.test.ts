/**
 * @vitest-environment jsdom
 *
 * Copy and callback coverage for the mid-conversation model/provider switch
 * confirmation dialog: the same- and cross-provider variants must carry
 * distinct pitfall copy, and both must explain the deferred-commit semantics
 * (takes effect on the next message; re-selecting the current model before
 * sending cancels the switch with no trace).
 */
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { describe, it, expect, afterEach, vi } from 'vitest';
import ModelSwitchConfirmDialog from '../ModelSwitchConfirmDialog.svelte';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderDialog(props: Record<string, unknown> = {}) {
  return render(ModelSwitchConfirmDialog, {
    props: {
      open: true,
      isProviderChange: false,
      fromModelLabel: 'gpt5.4',
      toModelLabel: 'sonnet4.5',
      fromProviderName: 'Augment Auggie',
      toProviderName: 'Augment Auggie',
      fromProviderId: 'auggie',
      toProviderId: 'auggie',
      ...props,
    },
  });
}

function dialogEl(): HTMLElement {
  const el = document.body.querySelector('[role="dialog"]');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

/** Dialog text with source-markup line breaks collapsed, for phrase assertions. */
function dialogText(): string {
  return dialogEl().textContent!.replace(/\s+/g, ' ');
}

describe('ModelSwitchConfirmDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('same-provider variant shows the milder model-switch copy', () => {
    renderDialog();
    const text = dialogText();

    expect(screen.getByText('Switch model mid-conversation?')).toBeTruthy();
    expect(text).toContain('Conversation history is kept');
    expect(text).toContain('cached context is lost');
    // The cross-provider warnings must NOT leak into the model-only variant.
    expect(text).not.toContain('replayed to the new provider');
    expect(text).not.toContain('re-sends the entire conversation');
    expect(screen.getByRole('button', { name: 'Switch model' })).toBeTruthy();
  });

  it('cross-provider variant shows the stronger replay/token-cost warning', () => {
    renderDialog({
      isProviderChange: true,
      toModelLabel: 'gpt-5-codex',
      toProviderName: 'OpenAI Codex',
      toProviderId: 'codex',
    });
    const text = dialogText();

    expect(screen.getByText('Switch provider mid-conversation?')).toBeTruthy();
    expect(text).toContain('sends this conversation to the new provider as plain text');
    expect(text).toContain('Tool details may be lost');
    expect(text).toContain('token usage may increase');
    const models = screen.getByTestId('model-switch-models');
    expect(models.querySelector('[title="Augment Auggie"] svg')).not.toBeNull();
    expect(models.querySelector('[title="OpenAI Codex"] svg')).not.toBeNull();
    expect(models.textContent).not.toContain(' / ');
    expect(models.textContent).not.toContain('→');
    expect(dialogEl().querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Switch provider' })).toBeTruthy();
  });

  it.each([{ isProviderChange: false }, { isProviderChange: true }])(
    'explains deferred commit and revert-cancels semantics (isProviderChange: $isProviderChange)',
    ({ isProviderChange }) => {
      renderDialog({ isProviderChange });
      const text = dialogText();

      expect(text).toContain('On your next message');
      expect(text).toContain('Current work finishes on the original model');
      expect(text).toContain('Choose it again before sending to cancel the switch');
    },
  );

  it('invokes onConfirm on the confirm button and onCancel on Cancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ onConfirm, onCancel });

    await fireEvent.click(screen.getByRole('button', { name: 'Switch model' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('visibly focuses the confirm action and renders no warning icon', async () => {
    renderDialog();
    const confirm = screen.getByRole('button', { name: 'Switch model' });

    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(dialogEl().querySelector('.svelte-fa')).toBeNull();
  });

  it('cancels via Escape', async () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });

    await fireEvent.keyDown(dialogEl(), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
