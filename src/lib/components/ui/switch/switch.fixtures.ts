import type { UiComponentFixture } from '../component-metadata';

export const switchFixtures = [
  {
    id: 'switch-state-matrix',
    title: 'Switch states',
    states: [
      'off',
      'on',
      'solid-primary',
      'inverted-thumb',
      'disabled',
      'invalid',
      'required-invalid',
      'keyboard-focus',
      'spring-reversal',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
