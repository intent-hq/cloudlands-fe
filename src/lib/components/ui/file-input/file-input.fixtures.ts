import type { UiComponentFixture } from '../component-metadata';

export const fileInputFixtures = [
  {
    id: 'file-input-state-matrix',
    title: 'File input states',
    states: [
      'default',
      'disabled',
      'invalid',
      'error',
      'loading',
      'busy',
      'long-content',
      'compact',
      'light',
      'dark',
      'keyboard-focus',
      'reduced-motion',
      'accept',
      'multiple',
      'multi-filename',
      'lifted-surface',
      'focus-within',
      'zoom-200',
      'no-overflow',
      'form-reset',
      'parent-reset',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
