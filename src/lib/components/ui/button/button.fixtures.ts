import type { UiComponentFixture } from '../component-metadata';

export const buttonFixtures = [
  {
    id: 'interaction-states',
    title: 'Button interaction states',
    states: [
      'default',
      'secondary',
      'outline',
      'destructive',
      'keyboard-focus',
      'disabled',
      'loading',
      'icon-only',
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
