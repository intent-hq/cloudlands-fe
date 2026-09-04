import type { UiComponentFixture } from '../component-metadata';

export const sidebarFixtures = [
  {
    id: 'sidebar-navigation',
    title: 'Sidebar responsive navigation states',
    states: [
      'default',
      'floating',
      'inset',
      'nested',
      'actions-and-badges',
      'header-footer-stacking',
      'callouts',
      'status-dots',
      'skeleton',
      'compact',
      'collapsed',
      'peek-hover',
      'resizing',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
