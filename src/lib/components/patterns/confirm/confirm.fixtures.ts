import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const confirmFixtures = [
  {
    id: 'confirm-service',
    title: 'Confirm service',
    states: ['confirm', 'prompt', 'alert', 'queued', 'busy', 'reduced-motion'],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
  {
    id: 'form-dialog',
    title: 'Form dialog',
    states: ['default', 'busy', 'invalid'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
  {
    id: 'destructive-confirm',
    title: 'Destructive confirm',
    states: ['default', 'typed-name', 'busy'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
