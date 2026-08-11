// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import CheckoutModePill from '../CheckoutModePill.svelte';

vi.mock('../shrink-workspace-action', () => ({
  runShrinkWorkspaceAction: vi.fn(),
}));

const originalResizeObserver = window.ResizeObserver;

beforeEach(() => {
  window.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  window.ResizeObserver = originalResizeObserver;
});

describe('CheckoutModePill hover target', () => {
  it('opens the checkout tooltip when disk usage is unavailable', async () => {
    const workspace = {
      id: 'ws-1',
      checkoutMode: 'worktree',
    } as unknown as Workspace;

    render(CheckoutModePill, { props: { workspace } });

    const icon = screen.getByLabelText('Checkout mode: Worktree');
    const trigger = document.querySelector<HTMLElement>('[data-tooltip-trigger]');
    expect(icon.className).toContain('cursor-help');
    expect(trigger).not.toBeNull();

    await fireEvent.pointerMove(trigger as HTMLElement, { pointerType: 'mouse' });

    const tooltip = await screen.findByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toContain('Checkout mode: Worktree');
  });

  it('opens the worktree disk-usage tooltip from its compact trigger', async () => {
    const workspace = {
      id: 'ws-1',
      checkoutMode: 'worktree',
      diskUsage: {
        bytes: 1024,
        fileCount: 1,
        computedAt: '2026-08-05T00:00:00Z',
        breakdown: [],
      },
    } as unknown as Workspace;

    render(CheckoutModePill, { props: { workspace } });

    const icon = screen.getByLabelText('Checkout mode: Worktree');
    const trigger = document.querySelector<HTMLElement>('[data-tooltip-trigger]');
    expect(icon.className).toContain('h-5');
    expect(icon.className).toContain('w-5');
    expect(trigger).not.toBeNull();

    trigger?.focus();
    await fireEvent.focus(trigger as HTMLElement);

    const tooltip = await screen.findByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toContain('Checkout mode: Worktree');
  });
});
