import type { UiComponentFixture } from '../component-metadata';

export const toggleFixtures = [
  {
    id: 'toggle-state-matrix',
    title: 'Toggle states',
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
    id: 'toggle-compatibility-modes',
    title: 'Deprecated Toggle modes',
    states: ['group', 'switch', 'indicator'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
