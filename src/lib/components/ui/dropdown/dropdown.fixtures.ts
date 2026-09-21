import type { UiComponentFixture } from '../component-metadata';

export const dropdownFixtures = [
  {
    id: 'dropdown-states',
    title: 'Dropdown states',
    states: ['closed', 'open', 'selected', 'disabled', 'search', 'long-content'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] as const satisfies readonly UiComponentFixture[];
