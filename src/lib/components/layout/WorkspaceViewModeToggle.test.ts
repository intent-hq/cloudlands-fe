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
    expect(toggle.querySelector('[data-icon="columns-plus-right"]')).toBeTruthy();

    await fireEvent.click(toggle);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/setWorkspaceViewMode',
      payload: ['columns'],
    });

    viewMode.set('columns');
    await waitFor(() => expect(toggle.querySelector('[data-icon="tabs"]')).toBeTruthy());
    await fireEvent.click(toggle);
    expect(mocks.dispatch).toHaveBeenLastCalledWith({
      type: 'tabState/setWorkspaceViewMode',
      payload: ['single'],
    });
  });

  it('keeps the title-bar button background transparent when active', () => {
    viewMode.set('columns');
    render(WorkspaceViewModeToggle);

    expect(screen.getByRole('button', { name: 'Open spaces' }).className).toContain(
      'data-[state=on]:bg-transparent!',
    );
  });
});
