import type { UiComponentFixture } from '../component-metadata';

export const badgeFixtures = [
  {
    id: 'semantic-states',
    title: 'Status meanings',
    states: [
      'neutral',
      'information',
      'success',
      'warning',
      'danger',
      'solid',
      'dot',
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
  {
    id: 'categorical-colours',
    title: 'Categorical colours — categorisation only',
    states: ['colors'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'compatibility',
    title: 'Legacy variants — compatibility only',
    states: ['default', 'secondary', 'outline', 'destructive', 'success-ring-dot', 'info-ring-dot'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
