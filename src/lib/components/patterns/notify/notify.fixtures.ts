import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const notifyFixtures = [
  {
    id: 'notify-states',
    title: 'Notification states',
    states: [
      'success',
      'info',
      'warning',
      'error',
      'progress',
      'undoable',
      'custom',
      'reduced-motion',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
