// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import { store as appStore } from '$store/renderer/store';
import {
  hudGridFilterHydrated,
  hudGridFilterStatesCleared,
} from '$store/renderer/slices/hud/hud-slice';
import { selectHudGridFilter } from '$store/renderer/slices/hud/hud-selectors';

import HudHeaderFilters from './HudHeaderFilters.svelte';

beforeAll(() => appStore.init());
afterAll(() => appStore.dispose());

beforeEach(() => {
  appStore.dispatch(hudGridFilterHydrated({ repo: null, states: [] }));
});

afterEach(() => cleanup());

describe('HudHeaderFilters status menu', () => {
  it('uses accessible menu checkbox items and keeps the menu open while toggling', async () => {
    render(HudHeaderFilters);

    const trigger = screen.getByRole('button', { name: 'Filter by status' });
    await fireEvent.click(trigger);

    const failed = await screen.findByRole('menuitemcheckbox', { name: /Failed/i });
    expect(failed.getAttribute('data-slot')).toBe('menu-checkbox-item');
    expect(failed.getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(failed);

    await waitFor(() => expect(failed.getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(selectHudGridFilter.select(appStore.state).states).toContain('failed');
  });

  it('supports keyboard selection and clearing all selected statuses', async () => {
    render(HudHeaderFilters);
    const trigger = screen.getByRole('button', { name: 'Filter by status' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });

    const blocked = await screen.findByRole('menuitemcheckbox', { name: /Blocked/i });
    blocked.focus();
    await fireEvent.keyDown(blocked, { key: ' ' });
    await waitFor(() =>
      expect(selectHudGridFilter.select(appStore.state).states).toContain('blocked'),
    );

    await fireEvent.click(screen.getByRole('menuitem', { name: /All statuses/i }));
    expect(selectHudGridFilter.select(appStore.state).states).toEqual([]);
    expect(screen.queryByRole('menu')).toBeNull();

    appStore.dispatch(hudGridFilterStatesCleared());
  });
});
