import type { UiComponentFixture } from '../component-metadata';

export const sliderFixtures = [
  {
    id: 'slider-state-matrix',
    title: 'Slider interaction states',
    states: [
      'default',
      'disabled',
      'invalid',
      'keyboard-focus',
      'arrow-keys',
      'home-end',
      'hover-thumb',
      'drag-tooltip',
      'synchronous-drag',
      'spring-settle',
      'semantic-track',
      'semantic-thumb',
      'compact',
      'light',
      'dark',
      'reduced-motion',
      'zoom-200',
      'no-overflow',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
