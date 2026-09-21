import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const formFixtures = [
  {
    id: 'form-states',
    title: 'Form states',
    states: ['rest', 'validating', 'error', 'submitting', 'disabled', 'reduced-motion'],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
