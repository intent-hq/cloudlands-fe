import type { UiComponentFixture } from '../component-metadata';

export const inputGroupFixtures = [
  {
    id: 'input-group-state-matrix',
    title: 'Input group states',
    states: [
      'rest',
      'hover',
      'focus',
      'error',
      'disabled',
      'leading-addon',
      'trailing-addon',
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
