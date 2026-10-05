import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '$lib/components/ui/button/button.variants';
import { m } from '$shared/paraglide/messages.js';
import SetupScriptModalBindingHost from './SetupScriptModalBindingHost.svelte';

const primaryClasses = buttonVariants({ variant: 'primary' }).split(/\s+/).filter(Boolean);

function hasPrimaryVariant(button: HTMLElement): boolean {
  return primaryClasses.every((token) => button.classList.contains(token));
}

function renderModal() {
  const onClose = vi.fn();
  render(SetupScriptModalBindingHost, { props: { onClose } });
  const boundValue = () => screen.getByLabelText('bound script value').textContent?.trim();
  const dialogState = () => screen.getByLabelText('dialog state').textContent?.trim();
  return {
    onClose,
    boundValue,
    dialogState,
    editValue: () => fireEvent.click(screen.getByTestId('edit-script')),
  };
}

const doneButton = () => screen.findByRole('button', { name: m.modals_setupScript_done_label() });
const saveAndDoneButton = () =>
  screen.findByRole('button', { name: m.modals_setupScript_saveAndDone_label() });

afterEach(cleanup);

describe('SetupScriptModal primary actions', () => {
  it('keeps Done on the primary button variant when nothing changed', async () => {
    const { onClose, boundValue, dialogState } = renderModal();

    const done = await doneButton();
    expect(hasPrimaryVariant(done)).toBe(true);
    expect(done.className).not.toContain('text-white');
    expect(
      screen.queryByRole('button', { name: m.modals_setupScript_saveAndDone_label() }),
    ).toBeNull();
    expect(primaryClasses).toContain('bg-transparent');
    expect(primaryClasses).toContain('text-primary-foreground');

    await fireEvent.click(done);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(dialogState()).toBe('closed');
    expect(boundValue()).toBe('echo one');
  });

  it('switches to a primary Save and Done that commits the edited script', async () => {
    const { onClose, boundValue, dialogState, editValue } = renderModal();
    await doneButton();

    await editValue();
    expect(boundValue()).toBe('echo one');

    const saveAndDone = await saveAndDoneButton();
    expect(hasPrimaryVariant(saveAndDone)).toBe(true);
    expect(saveAndDone.className).not.toContain('text-white');
    expect(screen.queryByRole('button', { name: m.modals_setupScript_done_label() })).toBeNull();

    await fireEvent.click(saveAndDone);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(dialogState()).toBe('closed');
    expect(boundValue()).toBe('echo two');
  });

  it('keeps Cancel off the primary variant and discards the edited script', async () => {
    const { onClose, boundValue, dialogState, editValue } = renderModal();
    await doneButton();
    await editValue();
    await saveAndDoneButton();

    const cancel = screen.getByRole('button', { name: m.modals_setupScript_cancel_label() });
    expect(hasPrimaryVariant(cancel)).toBe(false);

    await fireEvent.click(cancel);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(dialogState()).toBe('closed');
    expect(boundValue()).toBe('echo one');
  });
});
