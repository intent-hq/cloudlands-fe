// Source: OverlayCatalogPreview.svelte (sheet branch).
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as Sheet from '@/components/ui/sheet';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function SheetCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return (
    <div className="flex flex-wrap gap-3" data-catalog-renderer-fixture={fixture.id}>
      <div ref={setPortal} data-catalog-portal-target="sheet" />
      <div data-catalog-rendered-state="closed open right nested-content">
        <Sheet.Root>
          <Sheet.Trigger asChild>
            <Button variant="outline" size="sm">
              Open catalog sheet
            </Button>
          </Sheet.Trigger>
          <Sheet.Content portalProps={{ container: portal }} side="right">
            <Sheet.Header>
              <Sheet.Title>Catalog sheet</Sheet.Title>
              <Sheet.Description>Host-independent sheet preview.</Sheet.Description>
            </Sheet.Header>
            <Input className="h-8" aria-label="Sheet preview field" />
          </Sheet.Content>
        </Sheet.Root>
      </div>
      <div data-catalog-rendered-state="left disabled-close">
        <Sheet.Root>
          <Sheet.Trigger asChild>
            <Button variant="outline" size="sm">
              Open left sheet with disabled close
            </Button>
          </Sheet.Trigger>
          <Sheet.Content portalProps={{ container: portal }} side="left" closeDisabled>
            <Sheet.Title>Left sheet</Sheet.Title>
            <Sheet.Description>Disabled close control state.</Sheet.Description>
          </Sheet.Content>
        </Sheet.Root>
      </div>
    </div>
  );
}
