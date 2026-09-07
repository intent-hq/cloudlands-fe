/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notify } from '$lib/components/patterns/notify';
import RecipeSection from './RecipeSection.svelte';

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn() },
}));

const children = createRawSnippet(() => ({ render: () => '<p>Preview</p>' }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RecipeSection', () => {
  it('reports a rejected clipboard write without leaking an unhandled promise', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(RecipeSection, {
      props: { title: 'Recipe', description: 'Description', source: '<Button />', children },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy source' }));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Could not copy source.'));
    expect(writeText).toHaveBeenCalledWith('<Button />');
    expect(screen.getByRole('button', { name: 'Copy source' })).toBeTruthy();
  });
});
