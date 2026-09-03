// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectActivityLogPresets: () => ({
    subscribe: (run: (value: unknown[]) => void) => {
      run([]);
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: vi.fn() },
}));

import ActivityLogFiltersHarness from './ActivityLogFilters.test-harness.svelte';

afterEach(() => cleanup());

describe('ActivityLogFilters', () => {
  it('uses compact textless Toggles while preserving external labels and bindings', async () => {
    const { getByRole, getAllByRole, getByTestId } = render(ActivityLogFiltersHarness);

    const toggles = getAllByRole('button', { pressed: true });
    expect(toggles).toHaveLength(4);
    expect(toggles.every((toggle) => toggle.textContent?.trim() === '')).toBe(true);
    expect(getByRole('button', { name: 'File Changes' }).previousElementSibling?.textContent).toBe(
      'File Changes',
    );

    const fileChanges = getByRole('button', { name: 'File Changes' });
    await fireEvent.click(fileChanges);

    expect(fileChanges.getAttribute('aria-pressed')).toBe('false');
    expect(JSON.parse(getByTestId('filters').textContent ?? '{}').showFileChanges).toBe(false);
  });
});
