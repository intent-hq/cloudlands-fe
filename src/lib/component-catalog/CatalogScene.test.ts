// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Button from '../components/ui/button/button.svelte';
import { preview as buttonPreview } from '../components/ui/button/button.preview';
import CatalogScene from './CatalogScene.svelte';

const mocks = vi.hoisted(() => ({
  loadPreview: vi.fn(),
  setActivePreview: vi.fn(),
  waitForCaptureStability: vi.fn(),
}));

vi.mock('./preview-discovery', () => ({
  loadPreview: mocks.loadPreview,
  setActivePreview: mocks.setActivePreview,
}));

vi.mock('./capture-stability', () => ({
  waitForCaptureStability: mocks.waitForCaptureStability,
}));

const loadedButton = { component: Button, definition: buttonPreview };

describe('CatalogScene', () => {
  beforeEach(() => {
    mocks.loadPreview.mockReset();
    mocks.setActivePreview.mockReset();
    mocks.waitForCaptureStability.mockReset();
    mocks.loadPreview.mockImplementation(async (slug: string) =>
      slug === 'button' ? loadedButton : undefined,
    );
    mocks.waitForCaptureStability.mockResolvedValue({ imageCount: 0, reducedMotion: true });
  });

  afterEach(() => cleanup());

  it('renders a lazily discovered state and marks DOM readiness separately from stability', async () => {
    const preview = render(CatalogScene, {
      props: { slug: 'button', requestedState: 'loading', requestedWidth: 420 },
    });

    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true'),
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewState).toBe('loading');
    expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('420px');
    expect(screen.getByRole('button', { name: 'Saving' }).getAttribute('aria-busy')).toBe('true');
    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewStable).toBe('true'),
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewCaptureMotion).toBe('reduced');

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

  it('shows a terminal error when the preview import rejects', async () => {
    mocks.loadPreview.mockRejectedValueOnce(new Error('chunk unavailable'));
    render(CatalogScene, { props: { slug: 'button', requestedState: 'default' } });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Preview import failed: chunk unavailable',
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewStatus).toBe('error');
    expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('false');
  });

  it('shows a terminal error when state setup throws', async () => {
    mocks.loadPreview.mockResolvedValueOnce({
      component: Button,
      definition: {
        ...buttonPreview,
        defaultState: 'broken',
        states: {
          broken: {
            props: buttonPreview.states.default.props,
            setup: () => {
              throw new Error('fixture setup failed');
            },
          },
        },
      },
    });
    render(CatalogScene, { props: { slug: 'button', requestedState: 'broken' } });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Preview setup failed: fixture setup failed',
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewStatus).toBe('error');
    expect(mocks.waitForCaptureStability).not.toHaveBeenCalled();
  });

  it('keeps DOM readiness but reports capture preparation failure and cleans the fixture', async () => {
    const dispose = vi.fn();
    mocks.loadPreview.mockResolvedValueOnce({
      component: Button,
      definition: {
        ...buttonPreview,
        defaultState: 'prepared',
        states: {
          prepared: { props: buttonPreview.states.default.props, setup: () => dispose },
        },
      },
    });
    mocks.waitForCaptureStability.mockRejectedValueOnce(new Error('fonts unavailable'));
    render(CatalogScene, { props: { slug: 'button', requestedState: 'prepared' } });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Preview capture preparation failed: fonts unavailable',
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true');
    expect(screen.getByTestId('catalog-scene').dataset.previewStable).toBe('false');
    expect(screen.getByTestId('catalog-scene').dataset.previewStability).toBe('error');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('cancels preparation and cleans setup when the requested scene changes', async () => {
    const dispose = vi.fn();
    mocks.loadPreview.mockResolvedValueOnce({
      component: Button,
      definition: {
        ...buttonPreview,
        defaultState: 'first',
        states: { first: { props: buttonPreview.states.default.props, setup: () => dispose } },
      },
    });
    mocks.waitForCaptureStability.mockImplementationOnce(
      (_root: HTMLElement, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          ),
        ),
    );
    const preview = render(CatalogScene, {
      props: { slug: 'button', requestedState: 'first', requestedWidth: 420 },
    });
    await waitFor(() => expect(mocks.waitForCaptureStability).toHaveBeenCalledTimes(1));

    await preview.rerender({ slug: 'button', requestedState: 'default', requestedWidth: 420 });

    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewStable).toBe('true'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
