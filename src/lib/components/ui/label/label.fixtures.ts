import type { UiComponentFixture } from '../component-metadata';

export const labelFixtures = [
  {
    id: 'label-state-matrix',
    title: 'Label states',
    states: [
      'default',
      'required',
      'optional',
      'disabled',
      'long-content',
      'compact',
      'zoom-200',
      'light',
      'dark',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
