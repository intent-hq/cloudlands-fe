import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import WorkspaceStatusIcon from './WorkspaceStatusIcon.svelte';

describe('WorkspaceStatusIcon', () => {
  it.each([
    ['in_progress', 'In progress', 'circle', 'text-success'],
    ['blocked', 'Blocked', 'xmark', 'text-destructive'],
    ['failed', 'Failed', 'triangle-exclamation', 'text-foreground'],
  ] as const)('renders one accessible, shape-distinct %s icon', (status, label, icon, color) => {
    const view = render(WorkspaceStatusIcon, { props: { status, size: 12 } });
    const indicator = screen.getByRole('img', { name: label });

    expect(indicator.getAttribute('title')).toBe(label);
    expect(indicator.getAttribute('data-workspace-status')).toBe(status);
    expect(indicator.getAttribute('data-workspace-status-icon')).toBe(icon);
    expect(indicator.className).toContain(color);
    expect(indicator.className).toContain('forced-colors:text-[CanvasText]');
    expect(indicator.getAttribute('style')).toContain('width: 12px');
    expect(view.container.querySelectorAll('[data-workspace-status]')).toHaveLength(1);
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
