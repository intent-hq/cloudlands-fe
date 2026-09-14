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
  // Minimal composition from the breadcrumb-navigation default fixture.
  usage: `<script lang="ts">
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';
</script>

<Breadcrumb.Root aria-label="Page path">
  <Breadcrumb.List>
    <Breadcrumb.Item><Breadcrumb.Link href="/sandbox">Catalog</Breadcrumb.Link></Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item><Breadcrumb.Page>Components</Breadcrumb.Page></Breadcrumb.Item>
  </Breadcrumb.List>
</Breadcrumb.Root>`,
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
