import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const collectionFixtures = [
  {
    id: 'collection-states',
    title: 'Collection states',
    states: [
      'default',
      'single-selection',
      'multi-selection',
      'merged-selection',
      'keyboard-focus',
      'typeahead',
      'hover-actions',
      'empty',
      'loading',
      'error',
      'sectioned',
      'data-list',
      'virtualized',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
