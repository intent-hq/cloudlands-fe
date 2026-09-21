import type { UiComponentFixture } from '../component-metadata';
export const tableFixtures = [
  {
    id: 'table-state-matrix',
    title: 'Table states',
    states: [
      'default',
      'hover',
      'selected',
      'long-content',
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
