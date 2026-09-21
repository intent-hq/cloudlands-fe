import type { UiComponentFixture } from '../component-metadata';

export const copyInputFixtures = [
  {
    id: 'copy-input-state-matrix',
    title: 'Copy input states',
    states: [
      'rest',
      'hover',
      'focus',
      'copied',
      'error-feedback',
      'disabled',
      'button-variant',
      'left-aligned',
      'compact',
      'default-size',
      'light',
      'dark',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
