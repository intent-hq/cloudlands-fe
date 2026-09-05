import type { UiComponentFixture } from '../component-metadata';

export const inputMessageFixtures = [
  {
    id: 'input-message-state-matrix',
    title: 'Input message states',
    states: ['helper', 'error', 'light', 'dark', 'reduced-motion'],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] satisfies UiComponentFixture[];
