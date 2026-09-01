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
  it('uses compact shared checkboxes while preserving labels and bindings', async () => {
    const { getByRole, getAllByRole, getByTestId } = render(ActivityLogFiltersHarness);

    const checkboxes = getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes.every((checkbox) => checkbox.className.includes('h-3.5'))).toBe(true);

    const fileChanges = getByRole('checkbox', { name: 'File Changes' });
    await fireEvent.click(fileChanges);

    expect(fileChanges.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(getByTestId('filters').textContent ?? '{}').showFileChanges).toBe(false);
  });
});
