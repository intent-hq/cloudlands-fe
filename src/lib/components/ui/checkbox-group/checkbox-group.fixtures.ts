import type { UiComponentFixture } from '../component-metadata';

export const checkboxGroupFixtures = [
  {
    id: 'checkbox-group-state-matrix',
    title: 'Checkbox group states',
    states: [
      'stacked',
      'inline',
      'none-selected',
      'contiguous-selected',
      'split-selected',
      'description',
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
    id: 'checkbox-group-selected-row',
    title: 'Checkbox group selected row',
    states: ['one-line', '36px-row', 'selected-row', 'keyboard-roving'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
