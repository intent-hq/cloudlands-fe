import type { UiComponentFixture } from '../component-metadata';

export const toggleGroupFixtures = [
  {
    id: 'toggle-group-state-matrix',
    title: 'Toggle group states',
    states: [
      'single',
      'multiple',
      'selected',
      'deselected',
      'disabled',
      'keyboard-focus',
      'dark',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
