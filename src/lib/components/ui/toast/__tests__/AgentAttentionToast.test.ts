import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentAttentionToast from '../AgentAttentionToast.svelte';

describe('AgentAttentionToast', () => {
  afterEach(cleanup);

  it('fills the shared toast width and preserves Switch To and close actions', async () => {
    const onSwitchTo = vi.fn();
    const onClose = vi.fn();
    const { container } = render(AgentAttentionToast, {
      props: {
        title: 'Implementor requests a discussion',
        reason: 'Need a decision on the API shape',
        kind: 'discussion',
        onSwitchTo,
        onClose,
      },
    });

    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('w-full')).toBe(true);
    expect(root.classList.contains('min-w-0')).toBe(true);
    await fireEvent.click(screen.getByText('Switch To'));
    await fireEvent.click(screen.getByLabelText('Dismiss attention request'));
    expect(onSwitchTo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
