import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContentHeader from './ContentHeader.svelte';

afterEach(() => cleanup());

describe('ContentHeader title editing', () => {
  async function startEditing(title = 'My Note Title') {
    const onTitleChange = vi.fn();
    render(ContentHeader, { props: { title, editableTitle: true, onTitleChange } });
    await fireEvent.click(screen.getByRole('button', { name: title }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    return { input, onTitleChange };
  }

  it('sizes the title editor to its content without ch-based inline width', async () => {
    const { input } = await startEditing();

    expect(input.getAttribute('style')).toContain('field-sizing: content');
    expect(input.style.width).toBe('');
    expect(input.style.minWidth).toBe('');

    await fireEvent.input(input, { target: { value: 'A much longer panel title than before' } });
    expect(input.style.width).toBe('');
  });

  it('keeps the display-mode typography and truncation constraints on the editor', async () => {
    const { input } = await startEditing();

    const classes = input.className.split(/\s+/);
    expect(classes).toContain('text-sm');
    expect(classes).toContain('font-medium');
    expect(classes).toContain('min-w-[4ch]');
    expect(classes).toContain('max-w-full');
  });

  it('applies the title decoration classes in display and edit modes', async () => {
    const title = 'My Note Title';
    render(ContentHeader, {
      props: { title, editableTitle: true, onTitleChange: vi.fn() },
    });
    const titleButton = screen.getByRole('button', { name: title });
    const decoration = titleButton.parentElement?.querySelector<HTMLElement>(
      ':scope > [aria-hidden="true"]',
    );

    expect(decoration).toBeTruthy();
    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-1',
        '-inset-y-0.5',
        'border-transparent',
        'bg-transparent',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
    );

    await fireEvent.click(titleButton);

    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-2',
        '-inset-y-1.5',
        'border-ring/60',
        'bg-background',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
    );
  });

  it('saves the edited title on Enter', async () => {
    const { input, onTitleChange } = await startEditing();

    await fireEvent.input(input, { target: { value: 'Renamed Title' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onTitleChange).toHaveBeenCalledWith('Renamed Title');
  });

  it('cancels editing on Escape without saving', async () => {
    const { input, onTitleChange } = await startEditing();

    await fireEvent.input(input, { target: { value: 'Discarded Title' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(onTitleChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'My Note Title' })).toBeTruthy();
  });
});
