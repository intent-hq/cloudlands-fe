/**
 * @vitest-environment jsdom
 *
 * Covers persistence timing and specialist prompt blur/resync regressions.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAppClient } from '$lib/client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import AutoSaveTextarea from './AutoSaveTextarea.svelte';

const originalInvoke = window.electronAPI!.invoke;

describe('AutoSaveTextarea persistence timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockIpcRouter();
  });
  afterEach(() => {
    cleanup();
    window.electronAPI!.invoke = originalInvoke;
    resetMockIpcRouter();
    vi.useRealTimers();
  });

  it('debounces specialist draft saves and trims the persisted value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(AutoSaveTextarea, {
      props: { value: 'Original', originalValue: 'Original', onSave },
    });

    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '  Edited prompt  ' } });
    await vi.advanceTimersByTimeAsync(999);
    expect(onSave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith('Edited prompt');
  });

  it('supports immediate Ctrl/Cmd+S without a duplicate debounced save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(AutoSaveTextarea, {
      props: { value: 'Original', originalValue: 'Original', onSave },
    });
    const textarea = screen.getByRole('textbox');
    await fireEvent.input(textarea, { target: { value: 'Save now' } });

    await fireEvent.keyDown(textarea, { key: 's', ctrlKey: true });
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledWith('Save now');

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('persists a specialist prompt through the documented specialist.edit backend route', async () => {
    const client = new LiveAppClient();
    const spec = {
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Reviews changes',
      codingAgent: 'auggie',
      model: 'sonnet4.5',
      behaviorPrompt: 'Edited prompt',
      source: 'user' as const,
    };
    const request = {
      method: 'specialist.edit',
      params: { id: 'reviewer', spec, scope: 'user' },
    };
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
      expect(payload).toEqual(request);
      return { ok: true, result: { specialist: spec } };
    });
    window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
      mockInvoke(channel, payload),
    );
    const onSave = vi.fn((behaviorPrompt: string) =>
      client.specialists.edit('reviewer', { ...spec, behaviorPrompt }, 'user'),
    );
    render(AutoSaveTextarea, {
      props: { value: 'Original', originalValue: 'Original', onSave },
    });

    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Edited prompt' } });
    await vi.advanceTimersByTimeAsync(1000);

    expect(onSave).toHaveBeenCalledWith('Edited prompt');
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, request);
  });

  it('blocks autosave while over the character limit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(AutoSaveTextarea, {
      props: {
        value: 'Base',
        originalValue: 'Base',
        maxLength: 5,
        onSave,
      },
    });
    const textarea = screen.getByRole('textbox');
    await fireEvent.input(textarea, { target: { value: 'Too long' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSave).not.toHaveBeenCalled();
  });
});

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
