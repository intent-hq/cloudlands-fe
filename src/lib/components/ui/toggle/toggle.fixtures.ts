import type { UiComponentFixture } from '../component-metadata';

export const toggleFixtures = [
  {
    id: 'toggle-state-matrix',
    title: 'Toggle states',
    states: [
      'off',
      'on',
      'deselected',
      'selected',
      'disabled',
      'keyboard-focus',
      'hover-overlay',
      'active-overlay',
      'dark',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
