import type { UiComponentFixture } from '../component-metadata';

export const kbdFixtures = [
  {
    id: 'shortcut-chip-states',
    title: 'Keyboard hint states',
    states: ['single-key', 'modifier', 'key-sequence', 'long-key', 'light', 'dark', 'zoom-200'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
