import type { UiComponentFixture } from '../component-metadata';

export const textareaFixtures = [
  {
    id: 'textarea-state-matrix',
    title: 'Textarea states',
    states: [
      'default',
      'empty',
      'placeholder',
      'disabled',
      'read-only',
      'invalid',
      'described',
      'auto-expand',
      'max-height-scroll',
      'long-content',
      'light',
      'dark',
      'zoom-200',
      'keyboard-focus',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
