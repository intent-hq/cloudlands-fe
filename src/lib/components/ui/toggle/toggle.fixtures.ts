import type { UiComponentFixture } from '../component-metadata';

export const toggleFixtures = [
  {
    id: 'toggle-state-matrix',
    title: 'Compact Toggle states',
    states: [
      'unpressed',
      'pressed',
      'disabled',
      'keyboard-focus',
      'light',
      'dark',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
  {
    id: 'toggle-group-compatibility-mode',
    title: 'Deprecated Toggle group mode',
    states: ['group'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
