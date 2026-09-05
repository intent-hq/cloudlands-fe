import type { UiComponentFixture } from '../component-metadata';

export const tabsFixtures = [
  {
    id: 'tabs-state-matrix',
    title: 'Tabs states',
    states: [
      'default',
      'subtle',
      'selected',
      'proximity-hover',
      'keyboard-navigation',
      'disabled',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
