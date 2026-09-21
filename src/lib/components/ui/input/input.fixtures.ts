import type { UiComponentFixture } from '../component-metadata';

export const inputFixtures = [
  {
    id: 'input-state-matrix',
    title: 'Input states',
    states: [
      'default',
      'rest',
      'hover',
      'focus',
      'empty',
      'placeholder',
      'disabled',
      'read-only',
      'invalid',
      'error',
      'described',
      'keyboard-focus',
      'long-content',
      'light',
      'dark',
      'zoom-200',
      'file',
      'compact-28',
      'medium-32',
      'large-36',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
