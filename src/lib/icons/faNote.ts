import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

/**
 * Custom Note icon in FontAwesome format
 * Three horizontal lines with the last one shorter (text/note icon)
 */
export const faNote: IconDefinition = {
  prefix: 'fas',
  iconName: 'note-sticky' as const,
  icon: [
    16, // width
    16, // height
    [], // ligatures (deprecated)
    'e002', // unicode (arbitrary unique value)
    'M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z', // svgPathData
  ],
};
