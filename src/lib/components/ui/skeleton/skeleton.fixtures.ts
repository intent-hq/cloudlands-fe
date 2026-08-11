import type { UiComponentFixture } from '../component-metadata';

export const skeletonFixtures = [
  {
    id: 'skeleton-state-matrix',
    title: 'Skeleton loading states',
    states: [
      'default',
      'line',
      'avatar',
      'card',
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
