// Port of the tabs branch in NavigationPrimitivesCatalogPreview.svelte.
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function NavigationCatalogPreview({
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const [tab, setTab] = useState('overview');
  return (
    <div data-catalog-renderer-fixture={fixture.id}>
      <div data-catalog-rendered-state="default subtle selected proximity-hover keyboard-navigation disabled compact reduced-motion">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Catalog tabs">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="disabled" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">Overview content</TabsContent>
          <TabsContent value="activity">Activity content</TabsContent>
        </Tabs>
        <Tabs defaultValue="one" variant="subtle" className="mt-4">
          <TabsList aria-label="Subtle catalog tabs">
            <TabsTrigger value="one">Subtle one</TabsTrigger>
            <TabsTrigger value="two">Subtle two</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
