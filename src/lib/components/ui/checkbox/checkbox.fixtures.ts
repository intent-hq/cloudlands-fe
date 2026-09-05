import type { UiComponentFixture } from '../component-metadata';

export const checkboxFixtures = [
  {
    id: 'checkbox-state-matrix',
    title: 'Checkbox states',
    states: [
      'unchecked',
      'checked',
      'mixed',
      'solid-primary',
      'inverted-glyph',
      'disabled',
      'read-only',
      'invalid',
      'required-invalid',
      'keyboard-focus',
      'check-draw',
      'hover-weight',
      'generous-hit-target',
      'compact',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
