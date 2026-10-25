import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentIdleToast from '../AgentIdleToast.svelte';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('AgentIdleToast', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows who finished, the workspace, and the task, with Switch To and close wired', async () => {
    const onSwitchTo = vi.fn();
    const onClose = vi.fn();
    const { container } = render(AgentIdleToast, {
      props: {
        title: 'Builder finished',
        workspaceTitle: 'My Space',
        description: 'Fix the toast',
        onSwitchTo,
        onClose,
      },
    });

    expect(container.querySelector('[data-toast-layout="agent-idle"]')).not.toBeNull();
    expect(screen.getByText('Builder finished')).toBeTruthy();
    expect(container.querySelector('[data-toast-workspace]')?.textContent?.trim()).toBe('My Space');
    expect(container.querySelector('[data-toast-description]')?.textContent).toBe('Fix the toast');
    await fireEvent.click(screen.getByText('Switch To'));
    await fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(onSwitchTo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the workspace and description lines when absent and hides the badge without a slot', () => {
    const { container } = render(AgentIdleToast, {
      props: { title: 'Assistant: Planning', onSwitchTo: vi.fn(), onClose: vi.fn() },
    });
    expect(container.querySelector('[data-toast-workspace]')).toBeNull();
    expect(container.querySelector('[data-toast-description]')).toBeNull();
    expect(container.querySelectorAll('[data-toast-glyph]')).toHaveLength(1);
  });
});
