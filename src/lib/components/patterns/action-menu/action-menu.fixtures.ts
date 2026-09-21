import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export const actionMenuFixtures = [
  {
    id: 'action-menu-states',
    title: 'Action menu states',
    states: ['default', 'disabled', 'nested', 'context-menu', 'action-bar', 'overflow'],
    themes: ['light', 'dark'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
