import type { UiComponentFixture } from '../component-metadata';

export const inputFixtures = [
  {
    id: 'input-state-matrix',
    title: 'Input states',
    states: [
      'default',
      'empty',
      'placeholder',
      'disabled',
      'read-only',
      'invalid',
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
