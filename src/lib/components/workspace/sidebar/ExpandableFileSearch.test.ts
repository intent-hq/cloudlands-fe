import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ExpandableFileSearch from './ExpandableFileSearch.svelte';

describe('ExpandableFileSearch', () => {
  it('starts collapsed, expands with focus, and stays open while filled', async () => {
    const view = render(ExpandableFileSearch);
    await fireEvent.click(view.getByRole('button', { name: 'Search files...' }));

    const input = view.getByPlaceholderText('Search files...');
    expect(document.activeElement).toBe(input);
    await fireEvent.input(input, { target: { value: 'src' } });
    await fireEvent.blur(input);

    expect(view.getByPlaceholderText('Search files...')).toBe(input);
  });

  it('collapses after an empty search loses focus', async () => {
    const view = render(ExpandableFileSearch);
    await fireEvent.click(view.getByRole('button', { name: 'Search files...' }));
    await fireEvent.blur(view.getByPlaceholderText('Search files...'));

    await waitFor(() => expect(view.queryByPlaceholderText('Search files...')).toBeNull());
    expect(view.getByRole('button', { name: 'Search files...' })).toBeTruthy();
  });

  it('clears and collapses on Escape without forwarding the key', async () => {
    const onKeydown = vi.fn();
    const view = render(ExpandableFileSearch, { props: { onKeydown } });
    await fireEvent.click(view.getByRole('button', { name: 'Search files...' }));
    await fireEvent.keyDown(view.getByPlaceholderText('Search files...'), { key: 'Escape' });

    expect(onKeydown).not.toHaveBeenCalled();
    expect(view.queryByPlaceholderText('Search files...')).toBeNull();
  });
});
