import type { UiComponentFixture } from '../component-metadata';

export const scrollAreaFixtures = [
  {
    id: 'scroll-area-orientations',
    title: 'Scroll area orientations and overflow',
    states: [
      'vertical',
      'horizontal',
      'both',
      'keyboard-focus',
      'long-content',
      'no-overflow',
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
