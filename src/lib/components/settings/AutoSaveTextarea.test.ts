/**
 * @vitest-environment jsdom
 *
 * Regressions for the specialist prompt snap-back: blurring the textarea
 * before the debounced save fires must flush the pending save with the edited
 * text, and the prop→local resync must not clobber the edit when the `value`
 * prop did not actually change externally.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

import AutoSaveTextarea from './AutoSaveTextarea.svelte';

function textarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

async function typeText(text: string) {
  const el = textarea();
  await fireEvent.focus(el);
  el.value = text;
  await fireEvent.input(el);
  flushSync();
}

describe('AutoSaveTextarea blur/resync behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('flushes the pending debounced save on blur and keeps the edited text (snap-back regression)', async () => {
    const onSave = vi.fn();
    render(AutoSaveTextarea, {
      value: 'original prompt',
      originalValue: 'original prompt',
      onSave,
    });

    await typeText('edited prompt');
    // Blur before the 1s debounce fires — the edit must be saved, not lost.
    await fireEvent.blur(textarea());
    flushSync();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('edited prompt');
    // The unchanged `value` prop must not snap the textarea back on blur.
    expect(textarea().value).toBe('edited prompt');

    // The flushed debounce must not fire a duplicate save later.
    await vi.runAllTimersAsync();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe('edited prompt');
  });

  it('keeps the edited text after the debounced save fires and a later blur', async () => {
    const onSave = vi.fn();
    render(AutoSaveTextarea, {
      value: 'original prompt',
      originalValue: 'original prompt',
      onSave,
    });

    await typeText('edited prompt');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('edited prompt');

    await fireEvent.blur(textarea());
    flushSync();

    // No pending debounce ⇒ no duplicate save, and no snap-back.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe('edited prompt');
  });

  it('still resyncs when the value prop changes externally while not focused', async () => {
    const onSave = vi.fn();
    const { rerender } = render(AutoSaveTextarea, {
      value: 'original prompt',
      originalValue: 'original prompt',
      onSave,
    });

    await rerender({ value: 'reset prompt' });
    flushSync();

    expect(textarea().value).toBe('reset prompt');
    expect(onSave).not.toHaveBeenCalled();
  });
});
