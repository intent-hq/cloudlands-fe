// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatSearch from '../ChatSearch.svelte';

afterEach(() => cleanup());

describe('ChatSearch filters', () => {
  it('uses compact textless Toggles and searches with the updated option state', async () => {
    const onSearch = vi.fn();
    const { getByRole, getAllByRole } = render(ChatSearch, {
      props: {
        onSearch,
        onClose: vi.fn(),
        onNavigateResult: vi.fn(),
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Toggle filters' }));

    const toggles = getAllByRole('button', { pressed: false });
    expect(toggles).toHaveLength(2);
    expect(toggles.every((toggle) => toggle.textContent?.trim() === '')).toBe(true);

    const caseSensitive = getByRole('button', { name: 'Case sensitive' });
    onSearch.mockClear();
    await fireEvent.click(caseSensitive);

    expect(caseSensitive.getAttribute('aria-pressed')).toBe('true');
    expect(onSearch).toHaveBeenLastCalledWith(
      '',
      expect.objectContaining({ caseSensitive: true, regex: false }),
    );
  });
});
