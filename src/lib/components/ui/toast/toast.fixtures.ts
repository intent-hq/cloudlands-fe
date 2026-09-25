import type { UiComponentFixture } from '../component-metadata';

export const toastFixtures = [
  {
    id: 'toast-state-matrix',
    title: 'Toast notification styles',
    states: [
      'success',
      'error',
      'warning',
      'info',
      'loading',
      'notify-error-details',
      'app-error',
      'agent-failure',
      'agent-attention',
      'update-available',
      'update-downloading',
      'undoable-paused',
      'multi-toast-stack',
      'clear-all',
      'live-actions',
      'light',
      'dark',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
