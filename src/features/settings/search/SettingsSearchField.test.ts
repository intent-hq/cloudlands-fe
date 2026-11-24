import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/effective-shortcuts', async () => {
  const { readable } = await import('svelte/store');
  return { effectiveShortcutReadable: () => readable('Mod+F') };
});

import SettingsSearchField from './SettingsSearchField.svelte';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(value = '') {
  const onchange = vi.fn();
  const view = render(SettingsSearchField, { value, onchange });
  const input = screen.getByRole('searchbox') as HTMLInputElement;
  return { view, onchange, input };
}

describe('SettingsSearchField', () => {
  it('shows typing at once and searches once typing pauses', async () => {
    const { onchange, input } = setup();

    await fireEvent.input(input, { target: { value: 'the' } });
    await fireEvent.input(input, { target: { value: 'theme' } });
    expect(input.value).toBe('theme');
    expect(onchange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(onchange.mock.calls).toEqual([['theme']]);
  });

  it('searches at once on Enter and clears at once on Escape', async () => {
    const { onchange, input } = setup();

    await fireEvent.input(input, { target: { value: 'font' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onchange.mock.calls).toEqual([['font']]);

    await fireEvent.input(input, { target: { value: 'fonts' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(onchange.mock.calls).toEqual([['font'], ['']]);

    vi.advanceTimersByTime(150);
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  it("takes the page's reset and drops the pending search, from an empty query too", async () => {
    const { view, onchange, input } = setup('');

    await fireEvent.input(input, { target: { value: 'theme' } });
    // The page opened a tab: its query was still empty, so only reset() tells the field.
    view.component.reset();
    await tick();
    expect(input.value).toBe('');

    vi.advanceTimersByTime(150);
    expect(onchange).not.toHaveBeenCalled();
  });
});
