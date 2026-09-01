// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatSearch from '../ChatSearch.svelte';

afterEach(() => cleanup());

describe('ChatSearch filters', () => {
  it('uses compact shared checkboxes and searches with the updated option state', async () => {
    const onSearch = vi.fn();
    const { getByRole, getAllByRole } = render(ChatSearch, {
      props: {
        onSearch,
        onClose: vi.fn(),
        onNavigateResult: vi.fn(),
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Toggle filters' }));

    const checkboxes = getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.className.includes('h-3.5'))).toBe(true);

    const caseSensitive = getByRole('checkbox', { name: 'Case sensitive' });
    onSearch.mockClear();
    await fireEvent.click(caseSensitive);

    expect(caseSensitive.getAttribute('aria-checked')).toBe('true');
    expect(onSearch).toHaveBeenLastCalledWith(
      '',
      expect.objectContaining({ caseSensitive: true, regex: false }),
    );
  });
});
