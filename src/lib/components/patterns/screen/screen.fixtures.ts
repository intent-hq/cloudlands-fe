import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const screenFixtures = [
  {
    id: 'screen-states',
    title: 'Screen states',
    states: [
      'page',
      'takeover',
      'empty',
      'error',
      'error-danger',
      'loading-list',
      'loading-card-grid',
      'loading-form',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
