import type { UiComponentFixture } from '../component-metadata';

export const tooltipFixtures = [
  {
    id: 'tooltip-interaction',
    title: 'Tooltip interaction and content states',
    states: [
      'closed',
      'open',
      'hover-delay',
      'keyboard-focus',
      'escape-dismiss',
      'portal',
      'arrow',
      'disabled',
      'rich-content',
      'shortcut',
      'long-content',
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
