/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
const viewMode = writable<'single' | 'columns'>('single');

vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectWorkspaceViewMode: () => viewMode,
}));
import WorkspaceViewModeToggle from './WorkspaceViewModeToggle.svelte';

describe('WorkspaceViewModeToggle', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    viewMode.set('single');
  });

  it('toggles between single and column workspace views', async () => {
    render(WorkspaceViewModeToggle);
    const toggle = screen.getByRole('button', { name: 'Open spaces in columns' });
    expect(toggle.getAttribute('data-state')).toBe('off');
    expect(toggle.querySelector('[data-navigation-icon="spaces"]')).toBeTruthy();

    await fireEvent.click(toggle);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/setWorkspaceViewMode',
      payload: ['columns'],
    });

    viewMode.set('columns');
    await waitFor(() => expect(toggle.querySelector('[data-navigation-icon="tabs"]')).toBeTruthy());
    await fireEvent.click(toggle);
    expect(mocks.dispatch).toHaveBeenLastCalledWith({
      type: 'tabState/setWorkspaceViewMode',
      payload: ['single'],
    });
  });

  it('restores the destination glyph and keeps the pressed button transparent', () => {
    viewMode.set('columns');
    render(WorkspaceViewModeToggle);

    const toggle = screen.getByRole('button', { name: 'Open spaces' });
    expect(toggle.querySelector('[data-navigation-icon="tabs"]')).toBeTruthy();
    expect(toggle.title).toBe('Open spaces');
    expect(getComputedStyle(toggle).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(toggle.className).toContain('text-foreground');
  });

  it('tracks rapid mode changes without showing a stale destination glyph', async () => {
    render(WorkspaceViewModeToggle);
    const toggle = screen.getByRole('button', { name: 'Open spaces in columns' });

    viewMode.set('columns');
    viewMode.set('single');
    viewMode.set('columns');
    await waitFor(() => {
      expect(toggle.querySelector('[data-navigation-icon="tabs"]')).toBeTruthy();
      expect(toggle.querySelector('[data-navigation-icon="spaces"]')).toBeNull();
      expect(toggle.getAttribute('aria-label')).toBe('Open spaces');
    });
  });

  it('uses a 32px hit box and a 16px destination glyph', () => {
    const { container } = render(WorkspaceViewModeToggle);
    const toggle = screen.getByRole('button', { name: 'Open spaces in columns' });
    const icon = container.querySelector('[data-navigation-icon="spaces"]');

    expect(toggle.className).toContain('size-8');
    expect(toggle.className).toContain('shrink-0');
    expect(icon?.parentElement?.className).toContain('size-5');
    expect(icon?.getAttribute('width')).toBe('16');
    expect(icon?.getAttribute('height')).toBe('16');
  });
});
