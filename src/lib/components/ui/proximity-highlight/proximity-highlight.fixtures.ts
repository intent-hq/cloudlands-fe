import type { UiComponentFixture } from '../component-metadata';

export const proximityHighlightFixtures = [
  {
    id: 'proximity-highlight-state-matrix',
    title: 'Proximity highlight states',
    states: [
      'pointer-proximity',
      'keyboard-focus',
      'selected',
      'merged-selection',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
