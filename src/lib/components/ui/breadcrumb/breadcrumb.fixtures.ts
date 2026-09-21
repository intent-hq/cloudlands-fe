import type { UiComponentFixture } from '../component-metadata';

export const breadcrumbFixtures = [
  {
    id: 'breadcrumb-navigation',
    title: 'Breadcrumb navigation states',
    states: [
      'navigation',
      'current-page',
      'ellipsis',
      'long-content',
      'keyboard-focus',
      'overlay-hover',
      'compact',
      'zoom-200',
      'no-overflow',
      'light',
      'dark',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
