// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import SurfaceContextConsumer from './SurfaceContextConsumer.svelte';
import SurfaceContextHarness from './SurfaceContextHarness.svelte';
import SurfaceOverlayHarness from './SurfaceOverlayHarness.svelte';
import { clampSurface, surfaceClasses, surfaceHoverClasses } from './surface-context';

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(false);
      return () => undefined;
    },
  }),
}));

beforeEach(() => {
  window.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(async () => {
  toast.dismiss();
  await waitFor(() => expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0));
  cleanup();
});

describe('surface context', () => {
  it('defaults, provides, clamps, and resolves literal utility classes', () => {
    render(SurfaceContextHarness);
    expect(screen.getByTestId('unscoped-surface').textContent).toBe('1');
    expect(screen.getByTestId('provided-surface').textContent).toBe('3');
    expect(screen.getByTestId('nested-surface').textContent).toBe('8');
    expect(clampSurface(-2)).toBe(1);
    expect(clampSurface(6.6)).toBe(7);
    expect(surfaceClasses(3, 5)).toBe('bg-surface-3 shadow-surface-5');
    expect(surfaceHoverClasses(9)).toBe('hover:bg-surface-8 hover:shadow-surface-8');
  });

  it.each(['dialog', 'sheet', 'menu', 'select', 'combobox', 'tooltip', 'hover-card'] as const)(
    'raises the %s overlay two levels and provides its surface to children',
    async (kind) => {
      render(SurfaceOverlayHarness, { props: { kind, substrate: 2 } });
      expect((await screen.findByTestId(`${kind}-surface`)).textContent).toBe('4');
      expect(document.querySelector(`[data-surface-level="4"]`)).toBeTruthy();
    },
  );

  it('raises toast content and provides its surface to custom toast children', async () => {
    render(SurfaceOverlayHarness, { props: { kind: 'toast', substrate: 2 } });
    toast.custom(SurfaceContextConsumer, {
      duration: Number.POSITIVE_INFINITY,
      componentProps: { testId: 'toast-surface' },
    });
    expect((await screen.findByTestId('toast-surface')).textContent).toBe('4');
    expect(document.querySelector('#app-toast-region')?.getAttribute('data-surface-level')).toBe(
      '4',
    );
  });

  it('uses the provided overlay surface as the substrate for nested overlays and caps at eight', async () => {
    const nested = render(SurfaceOverlayHarness, { props: { kind: 'nested-menu', substrate: 2 } });
    expect((await screen.findByTestId('nested-menu-surface')).textContent).toBe('6');
    nested.unmount();

    render(SurfaceOverlayHarness, { props: { kind: 'menu', substrate: 7 } });
    expect((await screen.findByTestId('menu-surface')).textContent).toBe('8');
  });
});
