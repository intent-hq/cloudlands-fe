import type { UiComponentFixture } from '../component-metadata';

export const buttonGroupFixtures = [
  {
    id: 'orientations',
    title: 'Connected button orientations',
    states: ['horizontal', 'vertical', 'keyboard-focus', 'disabled', 'compact', 'dark'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
