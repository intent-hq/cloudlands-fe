import type { UiComponentFixture } from '../component-metadata';

export const settingsFieldRowFixtures = [
  {
    id: 'field-state-matrix',
    title: 'Settings field row states',
    states: [
      'default',
      'disabled',
      'invalid',
      'error',
      'loading',
      'busy',
      'long-content',
      'compact',
      'light',
      'dark',
      'keyboard-focus',
      'reduced-motion',
      'mobile-stacking',
      'zoom-200',
      'status-info',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
