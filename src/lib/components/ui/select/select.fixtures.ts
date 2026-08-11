import type { UiComponentFixture } from '../component-metadata';

export const selectFixtures = [
  {
    id: 'select-state-matrix',
    title: 'Select states',
    states: [
      'closed',
      'open',
      'selected',
      'selected-checkmark',
      'disabled',
      'invalid',
      'focus-visible',
      'compact-28',
      'medium-32',
      'large-36',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
  },
  {
    id: 'select-content',
    title: 'Select content and motion',
    states: ['empty', 'long-content', 'long-list', 'scrolling', 'portal', 'reduced-motion'],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
