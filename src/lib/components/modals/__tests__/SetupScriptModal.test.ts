import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '$lib/components/ui/button/button.variants';
import { m } from '$shared/paraglide/messages.js';
import SetupScriptModal from '../SetupScriptModal.svelte';

const primaryClasses = buttonVariants({ variant: 'primary' }).split(/\s+/).filter(Boolean);

function hasPrimaryVariant(button: HTMLElement): boolean {
  return primaryClasses.every((token) => button.classList.contains(token));
}

function renderModal() {
  const onClose = vi.fn();
  let setEditorValue: ((value: string) => void) | undefined;
  const editor = createRawSnippet<[string, (value: string) => void]>((_value, setValue) => {
    setEditorValue = setValue();
    return { render: () => '<div data-testid="editor-slot"></div>' };
  });
  render(SetupScriptModal, {
    props: { open: true, value: 'echo one', scriptName: 'One', editor, onClose },
  });
  return { onClose, editValue: (next: string) => setEditorValue?.(next) };
}

const doneButton = () => screen.findByRole('button', { name: m.modals_setupScript_done_label() });
const saveAndDoneButton = () =>
  screen.findByRole('button', { name: m.modals_setupScript_saveAndDone_label() });

afterEach(cleanup);

describe('SetupScriptModal primary actions', () => {
  it('keeps Done on the primary button variant when nothing changed', async () => {
    const { onClose } = renderModal();

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
  });

  it('switches to a primary Save and Done once the script is edited', async () => {
    const { onClose, editValue } = renderModal();
    await doneButton();

    editValue('echo two');

    const saveAndDone = await saveAndDoneButton();
    expect(hasPrimaryVariant(saveAndDone)).toBe(true);
    expect(saveAndDone.className).not.toContain('text-white');
    expect(screen.queryByRole('button', { name: m.modals_setupScript_done_label() })).toBeNull();

    await fireEvent.click(saveAndDone);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps Cancel off the primary variant and closes without committing', async () => {
    const { onClose, editValue } = renderModal();
    await doneButton();
    editValue('echo two');
    await saveAndDoneButton();

    const cancel = screen.getByRole('button', { name: m.modals_setupScript_cancel_label() });
    expect(hasPrimaryVariant(cancel)).toBe(false);

    await fireEvent.click(cancel);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
