// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CatalogScene from './CatalogScene.svelte';

vi.mock('./preview-discovery', async () => {
  const button = await import('../components/ui/button/button.preview');
  return {
    loadPreview: async (slug: string) =>
      slug === 'button' ? { component: button.default, definition: button.preview } : undefined,
    setActivePreview: vi.fn(),
  };
});

describe('CatalogScene', () => {
  afterEach(() => cleanup());

  it('renders a lazily discovered state at the requested width and marks it ready', async () => {
    const preview = render(CatalogScene, {
      props: { slug: 'button', requestedState: 'loading', requestedWidth: 420 },
    });

    await waitFor(
      () => expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true'),
      { timeout: 5_000 },
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewState).toBe('loading');
    expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('420px');
    expect(screen.getByRole('button', { name: 'Saving' }).getAttribute('aria-busy')).toBe('true');

    await preview.rerender({ slug: 'button', requestedState: 'disabled', requestedWidth: 320 });
    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewState).toBe('disabled'),
    );
    expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('320px');
    expect(screen.getByRole('button', { name: 'Unavailable' })).not.toBeNull();
  });

  it('keeps an invalid state visible and does not emit a false ready marker', async () => {
    render(CatalogScene, { props: { slug: 'button', requestedState: 'missing' } });

    expect((await screen.findByRole('alert')).textContent).toContain('Unknown state “missing”.');
    expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('false');
    expect(screen.getByText(/Available states:/).textContent).toContain('loading');
  });
});
