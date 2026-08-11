import type { UiComponentFixture } from '../component-metadata';

export const spinnerFixtures = [
  {
    id: 'spinner-state-matrix',
    title: 'Spinner loading states',
    states: [
      'default',
      'wave',
      'stair',
      'snake',
      'shuffle',
      'pulse',
      'seeded-colors',
      'custom-size-gap',
      'compact',
      'zoom-200',
      'light',
      'dark',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
