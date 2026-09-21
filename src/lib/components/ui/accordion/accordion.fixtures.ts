import type { UiComponentFixture } from '../component-metadata';

export const accordionFixtures = [
  {
    id: 'accordion-state-matrix',
    title: 'Accordion states',
    states: [
      'single',
      'multiple',
      'open',
      'closed',
      'disabled',
      'keyboard-navigation',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
