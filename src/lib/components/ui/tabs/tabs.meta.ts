import type { UiComponentMetadata } from '../component-metadata';
import { tabsFixtures } from './tabs.fixtures';

export const tabsMetadata = {
  id: 'tabs',
  source: 'src/lib/components/ui/tabs/index.ts',
  publicImport: '$lib/components/ui/tabs',
  legacyImports: [],
  exports: ['Content', 'List', 'Root', 'Tabs', 'TabsContent', 'TabsList', 'TabsTrigger', 'Trigger'],
  category: 'primitive',
  owner: 'design-system',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/tabs/tabs.test.ts',
  removalGate: 'Retain while exported; selection, motion, proximity, and keyboard tests must pass.',
  dynamicImports: [],
  fixtures: tabsFixtures,
} satisfies UiComponentMetadata;
