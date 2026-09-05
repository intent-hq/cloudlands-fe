import type { UiComponentFixture } from '../component-metadata';

export const cardFixtures = [
  {
    id: 'editorial-card',
    title: 'Editorial card states',
    states: [
      'default',
      'header',
      'interactive',
      'pressed',
      'empty',
      'long-content',
      'compact',
      'zoom-200',
      'inert',
      'light',
      'dark',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
