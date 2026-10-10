import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import DividerPanel from '../DividerPanel.svelte';

vi.mock('$lib/motion', () => ({ slide: () => ({ duration: 0 }) }));

const children = createRawSnippet(() => ({
  render: () =>
    '<div><button type="button">Choose repository</button><input aria-label="Target branch" /></div>',
}));

describe('DividerPanel delayed focus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.restoreAllMocks();
  });

  it('focuses the first input when the user has not moved focus', async () => {
    const view = render(DividerPanel, { open: true, children });
    await tick();
    await vi.advanceTimersByTimeAsync(180);
    expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Target branch' }));
  });

  it('preserves a repository control focused before the opening delay finishes', async () => {
    const view = render(DividerPanel, { open: true, children });
    await tick();
    const picker = view.getByRole('button', { name: 'Choose repository' });
    picker.focus();
    await vi.advanceTimersByTimeAsync(180);
    expect(document.activeElement).toBe(picker);
  });

  it('does not steal focus after the user moves outside the panel', async () => {
    const view = render(DividerPanel, { open: true, children });
    await tick();
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      outside.focus();
      await vi.advanceTimersByTimeAsync(180);
      expect(document.activeElement).toBe(outside);
      expect(document.activeElement).not.toBe(view.getByRole('textbox', { name: 'Target branch' }));
    } finally {
      outside.remove();
    }
  });
  it('cancels opening focus when the panel closes', async () => {
    const view = render(DividerPanel, { open: true, children });
    await tick();
    const input = view.getByRole('textbox', { name: 'Target branch' });
    const focus = vi.spyOn(input, 'focus');
    await view.rerender({ open: false });
    await vi.advanceTimersByTimeAsync(180);
    expect(focus).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
