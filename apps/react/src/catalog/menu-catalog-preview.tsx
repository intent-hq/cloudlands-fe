// Sources: OverlayCatalogPreview.svelte and patterns/action-menu/ActionMenuHarness.svelte.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { PaperclipIcon, PencilIcon, TrashIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { ActionBar, ActionMenu, defineActions } from '@/components/patterns/action-menu';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function ActionMenuHarness({
  bar = false,
  context = false,
}: {
  bar?: boolean;
  context?: boolean;
}) {
  const [selected, setSelected] = useState('none');
  const actions = defineActions([
    { id: 'metadata', kind: 'label', label: 'Document metadata', when: false },
    { id: 'edit', label: 'Edit', icon: PencilIcon, shortcut: '⌘E', group: 'file' },
    { id: 'hidden', label: 'Hidden', when: false, group: 'file' },
    {
      id: 'export',
      label: 'Export',
      group: 'file',
      children: [{ id: 'export-pdf', label: 'Export as PDF' }],
    },
    { id: 'locked', label: 'Locked', disabledReason: 'Requires access', group: 'file' },
    { id: 'delete', label: 'Delete', icon: TrashIcon, destructive: true, group: 'danger' },
  ]);
  return (
    <>
      {bar ? (
        <ActionBar
          actions={actions}
          visibleCount={1}
          overflowLabel="More actions"
          onAction={setSelected}
        />
      ) : (
        <ActionMenu
          actions={actions}
          ariaLabel="Document actions"
          contextMenu={context ? { x: 24, y: 32 } : undefined}
          onAction={setSelected}
          trigger={({ props }) => <Button {...props}>Actions</Button>}
        />
      )}
      <output data-testid="selected">{selected}</output>
    </>
  );
}

export function MenuCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const [checked, setChecked] = useState(false);
  const [density, setDensity] = useState('comfortable');
  const [open, setOpen] = useState(false);
  const [outsideClicks, setOutsideClicks] = useState(0);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return (
    <div className="flex flex-wrap gap-3" data-catalog-renderer-fixture={fixture.id}>
      <div ref={setPortal} data-catalog-portal-target="menu" />
      <div data-catalog-rendered-state="closed open disabled checked radio-selected submenu-open">
        <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
          <Menu.Trigger asChild>
            <Button variant="outline" size="sm" active={open}>
              Open catalog menu
            </Button>
          </Menu.Trigger>
          <Menu.Content portalProps={{ container: portal }} preventScroll={false}>
            <Menu.Group>
              <Menu.Label icon={PaperclipIcon}>Commands</Menu.Label>
              <Menu.Item>Run command</Menu.Item>
              <Menu.CommandItem icon={PaperclipIcon} label="Attach files" shortcut="⇧⌘A" />
              <Menu.Item disabled>Disabled command</Menu.Item>
              <Menu.CheckboxItem
                checked={checked}
                onCheckedChange={(value) => setChecked(value === true)}
                closeOnSelect={false}
              >
                Show panel
              </Menu.CheckboxItem>
              <Menu.RadioGroup value={density} onValueChange={setDensity}>
                <Menu.RadioItem value="compact" closeOnSelect={false}>
                  Compact
                </Menu.RadioItem>
                <Menu.RadioItem value="comfortable" closeOnSelect={false}>
                  Comfortable
                </Menu.RadioItem>
              </Menu.RadioGroup>
              <Menu.Sub>
                <Menu.SubTrigger icon={PaperclipIcon}>More actions</Menu.SubTrigger>
                <Menu.SubContent portalProps={{ container: portal }}>
                  <Menu.Item>Archive</Menu.Item>
                </Menu.SubContent>
              </Menu.Sub>
            </Menu.Group>
          </Menu.Content>
        </Menu.Root>
        <Button variant="outline" size="sm" onClick={() => setOutsideClicks((count) => count + 1)}>
          Menu outside target
        </Button>
        <output className="block type-caption text-muted-foreground">
          Outside clicks received: {outsideClicks}. Click outside an open menu to dismiss it.
        </output>
      </div>
    </div>
  );
}
