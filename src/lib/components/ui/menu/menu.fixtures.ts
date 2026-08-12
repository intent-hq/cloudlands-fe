import type { UiComponentFixture } from '../component-metadata';

export const menuFixtures = [
  {
    id: 'menu-command-states',
    title: 'Command menu states',
    states: [
      'closed',
      'open',
      'disabled',
      'destructive',
      'checked',
      'radio-selected',
      'submenu-open',
      'long-content',
      'scrolling',
      'keyboard-focus',
      'escape-dismiss',
      'outside-dismiss',
      'focus-return',
      'compact',
      'icon-shortcut',
      'zoom-200',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
