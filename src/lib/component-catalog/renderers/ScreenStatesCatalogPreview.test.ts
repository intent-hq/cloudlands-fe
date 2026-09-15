// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ScreenStatesCatalogPreview from './ScreenStatesCatalogPreview.svelte';

afterEach(cleanup);

describe('ScreenStatesCatalogPreview', () => {
  const fixture = {
    id: 'screen-feedback-state-matrix',
    title: 'Screen and feedback state matrix',
    states: ['screen', 'empty', 'error', 'loading', 'notice'],
  };

  it('renders every matrix cell with a unique stable preview tag', () => {
    const { container } = render(ScreenStatesCatalogPreview, {
      props: { componentId: 'screen-states', fixture },
    });
    const previews = [...container.querySelectorAll('[data-screen-preview]')];
    const ids = previews.map((preview) => preview.getAttribute('data-screen-preview'));

    expect(previews.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'screen-composition-320',
        'empty-long-icon-actions-320',
        'error-danger-details-320',
        'loading-reduced-motion',
        'loading-zoom-200',
        'media-unavailable-actions-320',
        'notify-error-toast-static',
      ]),
    );
  });

  it('uses compact, reduced-motion, and static feedback component contracts', () => {
    const { container } = render(ScreenStatesCatalogPreview, {
      props: { componentId: 'screen-states', fixture },
    });

    expect(container.querySelector('[data-density="compact"]')).toBeTruthy();
    expect(container.querySelector('[data-reduced-motion] [data-playing="false"]')).toBeTruthy();
    expect(
      container.querySelector(
        '[data-screen-preview="notice-banner"] [data-slot="sidebar-callout"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-screen-preview="media-unavailable-missing"] [data-testid="media-unavailable"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-screen-preview="notify-error-toast-static"] [data-toast-layout="error-details"]',
      ),
    ).toBeTruthy();
  });
});
