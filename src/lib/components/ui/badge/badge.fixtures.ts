import type { UiComponentFixture } from '../component-metadata';

export const badgeFixtures = [
  {
    id: 'semantic-states',
    title: 'Badge semantic states',
    states: [
      'default',
      'outline',
      'destructive',
      'success-ring-dot',
      'info-ring-dot',
      'leading-icon',
      'removable',
      'keyboard-focus',
      'long-label',
      'light',
      'dark',
      'compact',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
