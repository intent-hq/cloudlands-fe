import type { UiComponentMetadata } from '../component-metadata';
import { tabsFixtures } from './tabs.fixtures';

export const tabsMetadata = {
  id: 'tabs',
  source: 'src/lib/components/ui/tabs/index.ts',
  publicImport: '$lib/components/ui/tabs',
  legacyImports: [],
  exports: ['Content', 'List', 'Root', 'Tabs', 'TabsContent', 'TabsList', 'TabsTrigger', 'Trigger'],
  // Minimal composition from the tabs-state-matrix default fixture.
  usage: `<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs';
</script>

<Tabs.Root value="overview">
  <Tabs.List aria-label="Workspace tabs">
    <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
    <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="overview">Overview content</Tabs.Content>
  <Tabs.Content value="activity">Activity content</Tabs.Content>
</Tabs.Root>`,
  category: 'primitive',
  owner: 'design-system',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/tabs/tabs.test.ts',
  removalGate:
    'Retain while exported; selection, motion, proximity, and keyboard tests must pass; captions keep constant weight and hover never covers the raised selected surface.',
  dynamicImports: [],
  fixtures: tabsFixtures,
} satisfies UiComponentMetadata;
