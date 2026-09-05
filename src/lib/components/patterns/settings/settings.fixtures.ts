import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const settingsFixtures = [
  {
    id: 'schema-controls',
    title: 'Schema-driven settings controls',
    states: [
      'default',
      'conditional',
      'filtered',
      'danger',
      'experimental',
      'custom',
      'reduced-motion',
    ],
    themes: ['light', 'dark'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
