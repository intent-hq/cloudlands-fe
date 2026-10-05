import type { UiComponentFixture } from '../component-metadata';

export const searchableSelectFixtures = [
  {
    id: 'searchable-select-states',
    title: 'Searchable select states',
    states: ['default', 'selected', 'disabled', 'search', 'long-content'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] as const satisfies readonly UiComponentFixture[];
