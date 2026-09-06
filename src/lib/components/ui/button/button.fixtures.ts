import type { UiComponentFixture } from '../component-metadata';

export const buttonFixtures = [
  {
    id: 'interaction-states',
    title: 'Button interaction states',
    states: [
      'emphasis-ladder',
      'size-ladder',
      'guidance',
      'default',
      'primary',
      'secondary',
      'ghost',
      'outline',
      'destructive',
      'active',
      'keyboard-focus',
      'disabled',
      'loading',
      'loading-variants',
      'icon-only',
      'icon-weight',
      'action-feedback',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'content-and-motion',
    title: 'Button content and motion',
    states: ['long-label', 'light', 'dark', 'compact', 'reduced-motion', 'action-feedback'],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
