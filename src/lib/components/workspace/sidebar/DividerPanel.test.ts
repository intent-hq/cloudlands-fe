import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DividerPanel from './DividerPanel.svelte';

vi.mock('$lib/motion', () => ({ slide: () => ({ duration: 0 }) }));

const children = createRawSnippet(() => ({
  render: () => '<div><input aria-label="Target branch" /><input aria-label="Title" /></div>',
}));

function openPanel() {
  const view = render(DividerPanel, { open: true, children });
  flushSync();
  const panel = screen.getByRole('textbox', { name: 'Target branch' }).parentElement!
    .parentElement!;
  const scroll = vi.fn();
  panel.scrollIntoView = scroll;
  return { ...view, scroll };
}

describe('DividerPanel opening focus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('focuses the first input once when the user has not chosen a focus target', async () => {
    const { scroll } = openPanel();
    await vi.advanceTimersByTimeAsync(200);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Target branch' }));
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('does not redirect typing from a later field when delayed opening focus runs', async () => {
    openPanel();
    const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
    title.focus();
    await vi.advanceTimersByTimeAsync(200);
    expect(document.activeElement).toBe(title);
    const target = document.activeElement as HTMLInputElement;
    target.value = 'Original review title';
    expect(title.value).toBe('Original review title');
    expect((screen.getByRole('textbox', { name: 'Target branch' }) as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('preserves focus moved outside the panel during opening', async () => {
    const { scroll } = openPanel();
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      outside.focus();
      await vi.advanceTimersByTimeAsync(200);
      expect(document.activeElement).toBe(outside);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it('does not let an old opening timer focus a reopened panel early', async () => {
    const { rerender } = openPanel();
    await vi.advanceTimersByTimeAsync(100);
    await rerender({ open: false });
    await rerender({ open: true });
    const first = screen.getByRole('textbox', { name: 'Target branch' });
    first.parentElement!.parentElement!.scrollIntoView = vi.fn();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.activeElement).not.toBe(first);
    await vi.advanceTimersByTimeAsync(100);
    expect(document.activeElement).toBe(first);
  });
});
