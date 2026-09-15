import type { UiComponentFixture } from '../component-metadata';

export const sheetFixtures = [
  {
    id: 'sheet-state-matrix',
    title: 'Sheet states',
    states: [
      'closed',
      'open',
      'entering',
      'exiting',
      'top',
      'bottom',
      'left',
      'right',
      'disabled-close',
      'destructive-flow',
      'nested-content',
      'long-content',
      'scrolling',
      'compact',
      'zoom-200',
      'outside-dismiss',
      'escape-dismiss',
      'focus-return',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
