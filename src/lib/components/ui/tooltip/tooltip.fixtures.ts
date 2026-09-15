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
      'spring-enter',
      'crisp-exit',
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
  {
    id: 'tooltip-open-state',
    title: 'Tooltip open state',
    states: ['open-on-mount', 'portal', 'arrow', 'escape-dismiss', 'trigger-focus-preserved'],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
