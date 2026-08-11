import type { UiComponentFixture } from '../component-metadata';

export const listFixtures = [
  {
    id: 'editorial-list',
    title: 'Editorial list states',
    states: [
      'default',
      'selected',
      'active',
      'disabled',
      'loading',
      'metadata',
      'actions',
      'keyboard-focus',
      'collapsed',
      'empty-message',
      'long-content',
      'compact',
      'zoom-200',
      'reduced-motion',
      'light',
      'dark',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
