import { parseUiComponentMetadata } from '../component-metadata';
import { breadcrumbFixtures } from './breadcrumb.fixtures';

export const breadcrumbMetadata = parseUiComponentMetadata({
  id: 'breadcrumb',
  source: 'src/lib/components/ui/breadcrumb/index.ts',
  publicImport: '$lib/components/ui/breadcrumb',
  legacyImports: [],
  exports: [
    'Breadcrumb',
    'BreadcrumbEllipsis',
    'BreadcrumbItem',
    'BreadcrumbLink',
    'BreadcrumbList',
    'BreadcrumbPage',
    'BreadcrumbSeparator',
    'Ellipsis',
    'Item',
    'Link',
    'List',
    'Page',
    'Root',
    'Separator',
    'breadcrumbMetadata',
  ],
  category: 'primitive',
  owner: '012-F2',
  callers: [
    'src/lib/component-catalog/renderers/NavigationHelpCatalogPreview.svelte',
    'src/lib/components/file-explorer/file-explorer-layout.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/breadcrumb/breadcrumb.test.ts',
  removalGate: 'Retain while navigation, current-page, ellipsis, and responsive tests pass.',
  dynamicImports: [],
  fixtures: breadcrumbFixtures,
});
