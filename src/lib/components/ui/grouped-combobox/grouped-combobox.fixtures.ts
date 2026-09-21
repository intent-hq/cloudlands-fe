import type { UiComponentFixture } from '../component-metadata';

export const groupedComboboxFixtures = [
  {
    id: 'grouped-combobox-states',
    title: 'Grouped combobox states',
    states: ['default', 'selected', 'disabled', 'collapsed', 'expanded'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] as const satisfies readonly UiComponentFixture[];
