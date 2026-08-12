import type { UiComponentFixture } from '../component-metadata';

export const settingsPageShellFixtures = [
  {
    id: 'editorial-shell',
    title: 'Editorial Settings shell',
    states: [
      'default',
      'long-content',
      'compact',
      'light',
      'dark',
      'keyboard-focus',
      'back-action',
      'shortcut',
      'scroll-regions',
      'global-footer',
      'measure-standard',
      'horizontal-overflow',
      'mobile-stacking',
      'zoom-200',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'busy-shell',
    title: 'Busy Settings shell',
    states: [
      'loading',
      'busy',
      'reduced-motion',
      'back-href',
      'measure-wide',
      'stable-header',
      'stable-footer',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
