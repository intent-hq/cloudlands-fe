import type { UiComponentFixture } from '../component-metadata';

export const spinnerFixtures = [
  {
    id: 'spinner-state-matrix',
    title: 'Loading indicator states',
    states: [
      'bloom',
      'pulse',
      'twist',
      'size-16',
      'size-24',
      'size-32',
      'in-button',
      'in-list-row',
      'paused',
      'light',
      'dark',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
