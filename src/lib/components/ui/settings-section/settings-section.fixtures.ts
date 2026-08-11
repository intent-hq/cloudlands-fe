import type { UiComponentFixture } from '../component-metadata';

export const settingsSectionFixtures = [
  {
    id: 'section-state-matrix',
    title: 'Settings section states',
    states: [
      'default',
      'error',
      'loading',
      'busy',
      'long-content',
      'compact',
      'light',
      'dark',
      'keyboard-focus',
      'reduced-motion',
      'editorial-card',
      'mobile-wrapping',
      'zoom-200',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
