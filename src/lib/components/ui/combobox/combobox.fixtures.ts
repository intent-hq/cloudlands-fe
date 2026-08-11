import type { UiComponentFixture } from '../component-metadata';

export const comboboxFixtures = [
  {
    id: 'combobox-state-matrix',
    title: 'Combobox states',
    states: [
      'closed',
      'open',
      'selected',
      'selected-checkmark',
      'multi-selected',
      'disabled',
      'invalid',
      'loading',
      'keyboard-focus',
      'compact-28',
      'medium-32',
      'large-36',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
  },
  {
    id: 'combobox-results',
    title: 'Combobox result states',
    states: [
      'empty',
      'grouped',
      'long-content',
      'long-list',
      'scrolling',
      'portal',
      'focus-restored',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
