import type { UiComponentFixture } from '../component-metadata';

export const separatorFixtures = [
  {
    id: 'separator-state-matrix',
    title: 'Separator states',
    states: [
      'horizontal',
      'vertical',
      'decorative',
      'semantic',
      'compact',
      'zoom-200',
      'light',
      'dark',
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
  },
] satisfies UiComponentFixture[];
