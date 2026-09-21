import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import StaticDialogHarness from './StaticDialogHarness.svelte';

afterEach(cleanup);

describe('Dialog static positioning', () => {
  it('renders inline without locking page scroll or moving focus into the dialog', () => {
    const beforeOverflow = document.body.style.overflow;
    render(StaticDialogHarness);

    const frame = screen.getByTestId('static-dialog-frame');
    const dialog = screen.getByRole('dialog', { name: 'Static dialog' });
    const outsideAction = screen.getByRole('button', { name: 'Outside action' });

    expect(frame.contains(dialog)).toBe(true);
    expect(frame.contains(document.querySelector('[data-slot="dialog-overlay"]'))).toBe(true);
    expect(document.body.style.overflow).toBe(beforeOverflow);
    expect(document.documentElement.hasAttribute('data-scroll-locked')).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(false);

    outsideAction.focus();
    expect(document.activeElement).toBe(outsideAction);
  });
});
