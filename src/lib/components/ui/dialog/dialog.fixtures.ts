import type { UiComponentFixture } from '../component-metadata';

export const dialogFixtures = [
  {
    id: 'dialog-state-matrix',
    title: 'Dialog states',
    states: [
      'closed',
      'open',
      'focused',
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
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
