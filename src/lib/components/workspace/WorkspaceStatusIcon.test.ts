import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import WorkspaceStatusIcon from './WorkspaceStatusIcon.svelte';

describe('WorkspaceStatusIcon', () => {
  it.each([
    ['in_progress', 'In progress', 'workspace-status-color-active'],
    ['unread', 'Unread', 'workspace-status-color-unread'],
    ['idle', 'Idle', 'text-muted-foreground/35'],
    ['not_started', 'Not started', 'text-muted-foreground/35'],
  ] as const)('renders one accessible semantic %s dot', (status, label, color) => {
    const view = render(WorkspaceStatusIcon, { props: { status, size: 12 } });
    const indicator = screen.getByRole('img', { name: label });

    expect(indicator.getAttribute('title')).toBe(label);
    expect(indicator.getAttribute('data-workspace-status')).toBe(status);
    expect(indicator.getAttribute('data-workspace-status-visual')).toBe('dot');
    expect(indicator.hasAttribute('data-workspace-status-icon')).toBe(false);
    expect(indicator.className).toContain(color);
    expect(indicator.className).toContain('forced-colors:text-[CanvasText]');
    expect(indicator.getAttribute('style')).toContain('width: 12px');
    const dot = view.container.querySelector('[data-workspace-status-dot]');
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains('workspace-status-dot')).toBe(true);
    expect(view.container.querySelectorAll('[data-workspace-status-dot]')).toHaveLength(1);
    expect(view.container.querySelector('svg')).toBeNull();
    expect(view.container.querySelectorAll('[data-workspace-status]')).toHaveLength(1);
  });

  it('uses a labeled question icon for pending user input instead of a dot', () => {
    const view = render(WorkspaceStatusIcon, { props: { status: 'needs_attention' } });
    const indicator = screen.getByRole('img', { name: 'Needs attention' });

    expect(indicator.getAttribute('data-workspace-status-visual')).toBe('icon');
    expect(indicator.getAttribute('data-workspace-status-icon')).toBe('circle-question');
    expect(indicator.className).toContain('text-warning');
    expect(view.container.querySelector('[data-workspace-status-dot]')).toBeNull();
    expect(view.container.querySelector('svg')).not.toBeNull();
  });

  it('uses the canonical hourglass icon while waiting', () => {
    render(WorkspaceStatusIcon, { props: { status: 'waiting' } });

    const indicator = screen.getByRole('img', { name: 'Waiting' });
    expect(indicator.getAttribute('data-workspace-status-icon')).toBe('hourglass');
    expect(indicator.className).toContain('text-muted-foreground');
  });

  it('can be decorative when a parent provides the accessible status text', () => {
    const view = render(WorkspaceStatusIcon, {
      props: { status: 'complete', decorative: true },
    });
    const indicator = view.container.querySelector('[data-workspace-status="complete"]');

    expect(indicator?.getAttribute('aria-hidden')).toBe('true');
    expect(indicator?.hasAttribute('aria-label')).toBe(false);
    expect(indicator?.hasAttribute('title')).toBe(false);
  });
});
