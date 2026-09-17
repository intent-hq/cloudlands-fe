// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Textarea } from './custom-controls';
import Preview from './settings-textarea.preview.svelte';

afterEach(cleanup);

describe('Settings textarea bridge', () => {
  it('forwards native refs, value binding, input events and focus methods', async () => {
    render(Preview);
    const textarea = screen.getByRole('textbox', { name: 'Editable setting' });
    const events = screen.getByTestId('textarea-events');
    await fireEvent.click(screen.getByRole('button', { name: 'Focus setting' }));
    expect(document.activeElement).toBe(textarea);
    expect(events.getAttribute('data-native-ref')).toBe('TEXTAREA');
    expect(events.getAttribute('data-focuses')).toBe('1');
    await fireEvent.input(textarea, { target: { value: 'Edited preference' } });
    expect(events.textContent).toBe('Edited preference');
    expect(events.getAttribute('data-inputs')).toBe('1');
    await fireEvent.click(screen.getByRole('button', { name: 'Blur setting' }));
    expect(document.activeElement).not.toBe(textarea);
    expect(events.getAttribute('data-blurs')).toBe('1');
  });

  it('preserves external value updates and validation announcements', async () => {
    const oninput = vi.fn();
    const { rerender } = render(Textarea, {
      props: { 'aria-label': 'Setting', value: 'Before', error: 'Invalid preference', oninput },
    });
    const textarea = screen.getByRole('textbox', { name: 'Setting' }) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'Typing' } });
    expect(oninput).toHaveBeenCalledOnce();
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    await rerender({ value: 'Updated externally', error: undefined });
    expect(textarea.value).toBe('Updated externally');
    expect(textarea.hasAttribute('aria-invalid')).toBe(false);
  });
});
