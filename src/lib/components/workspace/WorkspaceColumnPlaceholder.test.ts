/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const workspace = writable<{ id: string; title?: string } | undefined>(undefined);

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => workspace,
}));

import WorkspaceColumnPlaceholder from './WorkspaceColumnPlaceholder.svelte';

describe('WorkspaceColumnPlaceholder', () => {
  beforeEach(() => {
    workspace.set({ id: 'ws-1', title: 'Dark mode work' });
  });

  it('renders the workspace title and a skeleton body without surface internals', () => {
    render(WorkspaceColumnPlaceholder, { props: { workspaceId: 'ws-1' } });

    const placeholder = document.querySelector('[data-workspace-column-placeholder="ws-1"]');
    expect(placeholder).toBeTruthy();
    expect(screen.getByText('Dark mode work')).toBeTruthy();
    expect(document.querySelector('[data-workspace-sidebar-skeleton]')).toBeTruthy();

    // No WorkspaceSurface internals: no surface root, panel layout, or chat input.
    expect(document.querySelector('[data-workspace-surface]')).toBeNull();
    expect(document.querySelector('[data-panel-layout]')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to the untitled label when the workspace has no title yet', () => {
    workspace.set(undefined);
    render(WorkspaceColumnPlaceholder, { props: { workspaceId: 'ws-1' } });

    expect(screen.getByText('Untitled')).toBeTruthy();
  });

  it('renders a draggable title region matching the real column title bar', () => {
    render(WorkspaceColumnPlaceholder, { props: { workspaceId: 'ws-1' } });

    const titleRegion = document.querySelector<HTMLElement>('[data-workspace-title-region]');
    expect(titleRegion).toBeTruthy();
    expect(titleRegion?.getAttribute('draggable')).toBe('true');
  });

  it('can disable the drag affordance on the title region', () => {
    render(WorkspaceColumnPlaceholder, {
      props: { workspaceId: 'ws-1', draggableTitleRegion: false },
    });

    expect(
      document.querySelector('[data-workspace-title-region]')?.getAttribute('draggable'),
    ).toBe('false');
  });

  it('exposes a close affordance that bypasses column activation', async () => {
    const onCloseWorkspace = vi.fn();
    render(WorkspaceColumnPlaceholder, { props: { workspaceId: 'ws-1', onCloseWorkspace } });

    const close = screen.getByRole('button', { name: 'Close workspace ws-1' });
    expect(close.hasAttribute('data-workspace-close')).toBe(true);
    await fireEvent.click(close);
    expect(onCloseWorkspace).toHaveBeenCalledTimes(1);
  });

  it('omits the close affordance when no close handler is provided', () => {
    render(WorkspaceColumnPlaceholder, { props: { workspaceId: 'ws-1' } });

    expect(document.querySelector('[data-workspace-close]')).toBeNull();
  });
});
