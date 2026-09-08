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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
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

  it('renders a lazily discovered state and marks DOM readiness after stability', async () => {
    const preview = render(CatalogScene, {
      props: { slug: 'button', requestedState: 'loading', requestedWidth: 420 },
    });

    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true'),
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewState).toBe('loading');
    expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('420px');
    expect(screen.getByRole('button', { name: 'Saving' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('link', { name: 'disabled' }).getAttribute('href')).toBe(
      '/?state=disabled&width=420',
    );
    expect(screen.getByRole('link', { name: '320px' }).getAttribute('href')).toBe(
      '/?state=loading&width=320',
    );
    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewStable).toBe('true'),
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewCaptureMotion).toBe('reduced');
    expect(mocks.setActivePreview).toHaveBeenLastCalledWith({
      slug: 'button',
      state: 'loading',
      width: 420,
      status: 'ready',
    });

    await preview.rerender({ slug: 'button', requestedState: 'disabled', requestedWidth: 320 });
    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewState).toBe('disabled'),
    );
    expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('320px');
    expect(screen.getByRole('button', { name: 'Unavailable' })).not.toBeNull();
  });

  it('renders only the component frame and publishes fit mode when requested', async () => {
    render(CatalogScene, {
      props: {
        slug: 'button',
        requestedState: 'loading',
        requestedWidth: 420,
        requestedFit: 'component',
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true'),
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewFit).toBe('component');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getAllByTestId('catalog-scene-focus')).toHaveLength(1);
    expect(mocks.setActivePreview).toHaveBeenLastCalledWith({
      slug: 'button',
      state: 'loading',
      width: 420,
      status: 'ready',
      fit: 'component',
    });
  });

  it('renders every state in declaration order and publishes all-states readiness', async () => {
    const setupDefault = vi.fn();
    const setupLoading = vi.fn();
    const disposeDefault = vi.fn();
    const disposeLoading = vi.fn();
    mocks.loadPreview.mockResolvedValueOnce({
      component: Button,
      definition: {
        ...buttonPreview,
        states: {
          default: {
            props: buttonPreview.states.default.props,
            setup: () => {
              setupDefault();
              return disposeDefault;
            },
          },
          loading: {
            props: buttonPreview.states.loading.props,
            setup: () => {
              expect(screen.getByRole('button', { name: 'Continue' })).not.toBeNull();
              expect(screen.queryByRole('button', { name: 'Saving' })).toBeNull();
              setupLoading();
              return disposeLoading;
            },
          },
        },
      },
    });

    const scene = render(CatalogScene, {
      props: { slug: 'button', requestedState: 'all', requestedWidth: 420 },
    });

    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true'),
    );
    expect(screen.getAllByTestId('catalog-scene-focus')).toHaveLength(2);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['State: default', 'State: loading']);
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Saving' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBe('page');
    expect(setupDefault).toHaveBeenCalledTimes(1);
    expect(setupLoading).toHaveBeenCalledTimes(1);
    expect(mocks.setActivePreview).toHaveBeenLastCalledWith({
      slug: 'button',
      state: 'all',
      width: 420,
      status: 'ready',
    });

    scene.unmount();
    expect(disposeDefault).toHaveBeenCalledTimes(1);
    expect(disposeLoading).toHaveBeenCalledTimes(1);
  });

  it('supports all-states mode for a preview with one state', async () => {
    mocks.loadPreview.mockResolvedValueOnce({
      component: Button,
      definition: {
        ...buttonPreview,
        states: { default: buttonPreview.states.default },
      },
    });

    render(CatalogScene, {
      props: { slug: 'button', requestedState: 'all', requestedWidth: 420 },
    });

    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true'),
    );
    expect(screen.getAllByTestId('catalog-scene-focus')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeNull();
    expect(mocks.setActivePreview).toHaveBeenLastCalledWith({
      slug: 'button',
      state: 'all',
      width: 420,
      status: 'ready',
    });
  });

  it('does not publish DOM or API readiness before capture stability resolves', async () => {
    const stability = deferred<{ imageCount: number; reducedMotion: boolean }>();
    mocks.waitForCaptureStability.mockReturnValueOnce(stability.promise);
    render(CatalogScene, {
      props: { slug: 'button', requestedState: 'loading', requestedWidth: 420 },
    });

    await waitFor(() => expect(mocks.waitForCaptureStability).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Saving' })).not.toBeNull();
    expect(screen.getByTestId('catalog-scene').dataset.previewStatus).toBe('loading');
    expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('false');
    expect(screen.getByTestId('catalog-scene').dataset.previewStability).toBe('waiting');
    expect(mocks.setActivePreview).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    );

    stability.resolve({ imageCount: 0, reducedMotion: true });
    await waitFor(() =>
      expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('true'),
    );
    expect(screen.getByTestId('catalog-scene').dataset.previewStable).toBe('true');
    expect(mocks.setActivePreview).toHaveBeenLastCalledWith({
      slug: 'button',
      state: 'loading',
      width: 420,
      status: 'ready',
    });
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

  it('does not publish readiness when capture preparation fails and cleans the fixture', async () => {
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
    expect(screen.getByTestId('catalog-scene').dataset.previewReady).toBe('false');
    expect(screen.getByTestId('catalog-scene').dataset.previewStable).toBe('false');
    expect(screen.getByTestId('catalog-scene').dataset.previewStability).toBe('error');
    expect(mocks.setActivePreview).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    );
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
    expect(mocks.setActivePreview).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: 'first', status: 'ready' }),
    );
    expect(mocks.setActivePreview).toHaveBeenLastCalledWith({
      slug: 'button',
      state: 'default',
      width: 420,
      status: 'ready',
    });
  });
});
