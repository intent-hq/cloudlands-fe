import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSurfaceLoadBoundary from './WorkspaceSurfaceLoadBoundary.svelte';

const workspaceShell = createRawSnippet(() => ({
  render: () => `
    <div data-workspace-layout>
      <aside data-workspace-sidebar></aside>
      <main data-panel-canvas><div data-resize-handle></div></main>
      <footer data-terminal-dock></footer>
      <div data-content-skeleton></div>
    </div>`,
}));

afterEach(cleanup);

function renderInViewport(mode: 'standalone' | 'column', kind: 'not_found' | 'error') {
  const viewport = document.createElement('div');
  viewport.dataset.visibleViewport = mode;
  viewport.dataset.theme = mode === 'column' ? 'dark' : 'light';
  viewport.classList.toggle('dark', mode === 'column');
  viewport.style.width = mode === 'column' ? '360px' : '960px';
  viewport.style.height = '640px';
  viewport.style.zoom = mode === 'column' ? '2' : '1';
  document.body.append(viewport);
  const onNavigateAway = vi.fn();

  render(WorkspaceSurfaceLoadBoundary, {
    target: viewport,
    props: {
      loadError: {
        kind,
        message: kind === 'error' ? 'Backend unavailable' : 'Workspace not found',
      },
      resourceLabel: 'Workspace',
      resourceId: 'missing-workspace',
      onNavigateAway,
      children: workspaceShell,
    },
  });
  return { viewport, onNavigateAway };
}

describe('WorkspaceSurfaceLoadBoundary', () => {
  it.each(['standalone', 'column'] as const)(
    'renders a shell-free missing state inside the %s viewport',
    async (mode) => {
      const { viewport, onNavigateAway } = renderInViewport(mode, 'not_found');
      const state = viewport.querySelector<HTMLElement>('[data-workspace-terminal-state]')!;

      expect(viewport.contains(state)).toBe(true);
      expect(state.classList).toContain('h-full');
      expect(state.classList).toContain('w-full');
      expect(viewport.dataset.theme).toBe(mode === 'column' ? 'dark' : 'light');
      expect(viewport.style.zoom).toBe(mode === 'column' ? '2' : '1');
      expect(screen.getByRole('heading', { name: 'Workspace not found' })).toBeTruthy();
      expect(screen.getByText('missing-workspace')).toBeTruthy();
      const recovery = screen.getByRole('button', { name: 'All workspaces' });
      recovery.focus();
      expect(document.activeElement).toBe(recovery);
      await fireEvent.click(recovery);
      expect(onNavigateAway).toHaveBeenCalledOnce();
      expect(document.querySelector('[data-workspace-layout]')).toBeNull();
      expect(document.querySelector('[data-workspace-sidebar]')).toBeNull();
      expect(document.querySelector('[data-panel-canvas]')).toBeNull();
      expect(document.querySelector('[data-terminal-dock]')).toBeNull();
      expect(document.querySelector('[data-resize-handle]')).toBeNull();
      expect(document.querySelector('[data-content-skeleton]')).toBeNull();
    },
  );

  it('keeps generic failures shell-free with distinct detail', () => {
    renderInViewport('column', 'error');
    expect(screen.getByRole('heading', { name: 'Failed to load workspace' })).toBeTruthy();
    expect(screen.getByText('Backend unavailable')).toBeTruthy();
    expect(document.querySelector('[data-workspace-layout]')).toBeNull();
  });

  it('retains the workspace shell when there is no terminal load error', () => {
    render(WorkspaceSurfaceLoadBoundary, {
      props: {
        loadError: null,
        resourceLabel: 'Workspace',
        resourceId: 'workspace-1',
        onNavigateAway: vi.fn(),
        children: workspaceShell,
      },
    });
    expect(document.querySelector('[data-workspace-layout]')).toBeTruthy();
    expect(document.querySelector('[data-workspace-terminal-state]')).toBeNull();
  });
});
