import type { UiComponentFixture } from '../component-metadata';

export const buttonGroupFixtures = [
  {
    id: 'orientations',
    title: 'Connected one-shot actions',
    states: ['horizontal', 'vertical', 'active', 'keyboard-focus', 'disabled', 'compact', 'dark'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
