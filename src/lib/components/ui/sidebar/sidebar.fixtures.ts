import type { UiComponentFixture } from '../component-metadata';

export const sidebarFixtures = [
  {
    id: 'sidebar-navigation',
    title: 'Sidebar responsive navigation states',
    states: [
      'expanded',
      'collapsed',
      'mobile-closed',
      'mobile-open',
      'active-menu-item',
      'disabled-menu-item',
      'collapsed-tooltip',
      'keyboard-shortcut',
      'compact',
      'zoom-200',
      'light',
      'dark',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
