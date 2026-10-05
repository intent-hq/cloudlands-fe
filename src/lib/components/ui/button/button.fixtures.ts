import type { UiComponentFixture } from '../component-metadata';

export const buttonFixtures = [
  {
    id: 'interaction-states',
    title: 'Button interaction states',
    states: [
      'emphasis-ladder',
      'size-ladder',
      'guidance',
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
    states: ['long-label', 'light', 'dark', 'reduced-motion', 'action-feedback'],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
  {
    id: 'compatibility-aliases',
    title: 'Compatibility aliases',
    states: ['default', 'compact'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
