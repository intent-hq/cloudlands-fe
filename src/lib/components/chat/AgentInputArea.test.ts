/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/button.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipShortcut: (await import('./__tests__/mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/components/chat/input/SimpleRichInput.svelte', async () => ({
  default: (await import('./__tests__/mocks/TipTapEditor.svelte')).default,
}));

import AgentInputArea from './AgentInputArea.svelte';

afterEach(() => cleanup());

describe('AgentInputArea stop controls', () => {
  it('does not stop streaming on Escape but keeps the stop button functional', async () => {
    const onStop = vi.fn();
    const { container } = render(AgentInputArea, {
      props: { isStreaming: true, showStopButton: true, onStop },
    });

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(onStop).not.toHaveBeenCalled();

    const stopButton = container.querySelector('button');
    expect(stopButton).not.toBeNull();
    await fireEvent.click(stopButton!);
    expect(onStop).toHaveBeenCalledOnce();
  });
});
