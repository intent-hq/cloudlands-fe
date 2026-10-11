// Sources: NavigationHelpCatalogPreview.svelte (sidebar), ContentFieldCatalogPreview.svelte (list).
// i18n-ignore (reference catalog fixture content)
import { DotsThreeIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import * as Sidebar from '@/components/ui/sidebar';
import { ListContainer, ListEmpty, ListItem, ListSection } from '@/components/ui/list';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function SidebarCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  return (
    <div
      className="grid w-full min-w-0 grid-cols-1 gap-4 overflow-hidden"
      data-catalog-renderer-fixture={fixture.id}
    >
      <div data-catalog-rendered-state="default floating inset nested actions-and-badges collapsed peek-hover resizing reduced-motion">
        <Sidebar.Harness insetAs="div" />
      </div>
      <p data-catalog-unimplemented="keyboard-focus">
        The reference keyboard-focus example requires the product SidebarExpandableSearch port.
      </p>
    </div>
  );
}

export function ListCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  return (
    <div
      className="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4 overflow-hidden"
      data-catalog-renderer-fixture={fixture.id}
    >
      <div data-catalog-rendered-state="default selected active disabled loading metadata actions keyboard-focus proximity-hover light dark compact zoom-200 reduced-motion">
        <ListContainer spacing="compact" interactive>
          <ListSection title="Recent work">
            <ListItem title="Selected item" subtitle="Supporting metadata" selected />
            <ListItem
              title="Active item"
              active
              actions={[{ icon: DotsThreeIcon, label: 'More actions', onClick: () => undefined }]}
              actionsVisible="always"
            />
            <ListItem title="Loading item" icon={DotsThreeIcon} loading />
            <ListItem title="Disabled item" disabled />
          </ListSection>
        </ListContainer>
      </div>
      <div data-catalog-rendered-state="collapsed">
        <ListContainer>
          <ListSection title="Collapsed section" collapsible collapsed />
        </ListContainer>
      </div>
      <div data-catalog-rendered-state="empty-message">
        <ListEmpty message="No catalog items" />
      </div>
      <div data-catalog-rendered-state="long-content">
        <ListContainer>
          <ListItem title="A deliberately long piece of editorial content that remains readable without overflowing a compact catalog viewport." />
        </ListContainer>
      </div>
    </div>
  );
}

function PersistenceSurface({ persist }: { persist: boolean }) {
  const [open, setOpen] = useState(true);
  const label = persist ? 'Persistent' : 'Isolated';
  return (
    <section
      data-functional-example={persist ? 'sidebar-persistent' : 'sidebar-isolated'}
      aria-label={`${label} sidebar`}
    >
      <h2>{label} sidebar</h2>
      <Sidebar.Provider
        open={open}
        onOpenChange={setOpen}
        persist={persist}
        shortcut={null}
        className="relative h-72 !min-h-0 overflow-hidden rounded-md border border-border"
      >
        <Sidebar.Root className="!absolute !inset-y-0 !h-full">
          <Sidebar.Header>{label} navigation</Sidebar.Header>
          <Sidebar.Content>
            <Sidebar.Menu>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton label="Overview" />
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Content>
        </Sidebar.Root>
        <Sidebar.Inset as="div" className="min-w-0 p-6">
          <Sidebar.Trigger aria-label={`Toggle ${label.toLowerCase()} sidebar`} />
          <output aria-label={`${label} sidebar open`}>{String(open)}</output>
        </Sidebar.Inset>
      </Sidebar.Provider>
    </section>
  );
}

// Additional browser exercise: the production provider and root saga own cookie writes.
export function SidebarPersistenceExample() {
  return (
    <div className="grid gap-8">
      <PersistenceSurface persist />
      <PersistenceSurface persist={false} />
    </div>
  );
}
