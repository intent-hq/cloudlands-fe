import type { UiComponentFixture } from '../component-metadata';

export const radioGroupFixtures = [
  {
    id: 'radio-group-state-matrix',
    title: 'Radio group states',
    states: [
      'stacked',
      'inline',
      'selected',
      'description',
      'multi-line-label',
      'custom-marker',
      'proximity-hover',
      'keyboard-roving',
      'disabled',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
  {
    id: 'radio-group-one-line-row',
    title: 'One-line radio group rows',
    states: ['one-line', '36px-row', 'selected', 'keyboard-roving'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
