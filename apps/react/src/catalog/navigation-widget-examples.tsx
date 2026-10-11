// i18n-ignore (internal reference harness and interaction example content)
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { PencilIcon, TrashIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { PanelFindBar } from '@/components/ui/panel-find-bar';
import { SmartCornerTabs } from '@/components/ui/smart-corner-tabs';
import {
  SidebarContextMenu,
  SidebarOverflowMenu,
  getSidebarContextPosition,
  type SidebarContextPosition,
  type SidebarMenuEntry,
} from '@/components/ui/sidebar-context-menu';
import { SearchableCombobox, type Option } from '@/components/ui/searchable-combobox';

// Exact SidebarMenuHarness.svelte data/controls; named variants set its existing props.
export function SidebarMenuExample({
  edge = false,
  long = false,
  multiline = false,
}: {
  edge?: boolean;
  long?: boolean;
  multiline?: boolean;
}) {
  const [context, setContext] = useState<SidebarContextPosition | null>(null);
  const [checked, setChecked] = useState(false);
  const [choice, setChoice] = useState('first');
  const [selected, setSelected] = useState('none');
  const items: SidebarMenuEntry[] = [
    { type: 'separator' },
    { id: 'rename', label: 'Rename', icon: PencilIcon, onClick: () => setSelected('rename') },
    {
      id: 'locked',
      label: 'Locked',
      icon: multiline ? PencilIcon : undefined,
      shortcut: multiline ? '⌘K' : undefined,
      disabledReason: multiline
        ? 'Requires access from the workspace owner before this command can be used.'
        : 'Requires access',
      onClick: () => setSelected('locked'),
    },
    { type: 'separator' },
    { type: 'separator' },
    { id: 'details', label: 'Show details', checked, onClick: () => setChecked(!checked) },
    {
      id: 'choices',
      label: 'Assign slot',
      selection: 'single',
      onClick: () => {},
      submenu: [
        {
          id: 'first',
          label: 'First slot',
          checked: choice === 'first',
          onClick: () => setChoice('first'),
        },
        {
          id: 'second',
          label: 'Second slot',
          checked: choice === 'second',
          onClick: () => setChoice('second'),
        },
      ],
    },
    {
      id: 'more',
      label: 'More',
      onClick: () => {},
      submenu: [{ id: 'export', label: 'Export', onClick: () => setSelected('export') }],
    },
    ...(long
      ? Array.from({ length: 35 }, (_, i) => ({
          id: `extra-${i}`,
          label: `Extra command ${i}`,
          onClick: () => setSelected(`extra-${i}`),
        }))
      : []),
    { type: 'separator' },
    {
      id: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      destructive: true,
      onClick: () => setSelected('delete'),
    },
    { type: 'separator' },
  ];
  function invoke(event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) {
    const position = getSidebarContextPosition(event);
    if (position) setContext(position);
  }
  return (
    <>
      <div style={edge ? { position: 'fixed', right: 12, bottom: 12 } : undefined}>
        <Button onContextMenu={invoke} onKeyDown={invoke}>
          Workspace
        </Button>
        <SidebarOverflowMenu items={items} ariaLabel="Workspace actions" />
      </div>
      <Button>After menu</Button>
      {context && (
        <SidebarContextMenu
          {...context}
          items={items}
          ariaLabel="Workspace actions"
          onClickOutside={() => setContext(null)}
        />
      )}
      <output data-testid="selection">{selected}</output>
      <output data-testid="checked">{String(checked)}</output>
      <output data-testid="choice">{choice}</output>
    </>
  );
}

// Source PanelFindBarTestHarness.svelte with real callback outcomes exposed for browser use.
export function FindBarExample() {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  return (
    <div className="grid gap-4">
      {closed ? (
        <Button onClick={() => setClosed(false)}>Reopen find</Button>
      ) : (
        <PanelFindBar
          query={query}
          onQueryChange={setQuery}
          searchAriaLabel="Test find"
          previousLabel="Previous match"
          nextLabel="Next match"
          closeLabel="Close find"
          layout="inline"
          totalMatches={3}
          currentMatchIndex={index}
          onPrevious={() => setIndex((value) => (value + 2) % 3)}
          onNext={() => setIndex((value) => (value + 1) % 3)}
          onClose={() => setClosed(true)}
        />
      )}
      <span data-testid="bound-query">{query}</span>
      <output aria-label="Find current match">{index}</output>
    </div>
  );
}

// Additional interaction caller using the source SmartCornerTabs.test.ts tab model.
export function SmartTabsExample() {
  const [active, setActive] = useState('overview');
  return (
    <>
      <p>Additional interaction example; no reference catalog scene.</p>
      <SmartCornerTabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'changes', label: 'Changes and review' },
          { id: 'activity', label: 'Activity' },
          { id: 'settings', label: 'Settings' },
        ]}
        ariaLabel="Demo tabs"
        activeTabId={active}
        onTabChange={setActive}
      >
        {(tab) => <p>{tab.label} content</p>}
      </SmartCornerTabs>
      <output aria-label="Smart tab selection">{active}</output>
    </>
  );
}

// Compatibility wrapper has no source catalog fixture; exercise rename through its public slot.
export function SearchableComboboxExample() {
  const [options, setOptions] = useState<Option[]>([
    { value: 'ada', label: 'Ada Lovelace' },
    { value: 'grace', label: 'Grace Hopper' },
    { value: 'locked', label: 'Unavailable person', data: { isSelectable: false } },
  ]);
  const [value, setValue] = useState('grace');
  return (
    <div className="grid max-w-md gap-4">
      <p>Additional interaction example; no reference catalog scene.</p>
      <SearchableCombobox
        ariaLabel="Searchable people"
        value={value}
        onChange={setValue}
        options={options}
        onRename={(option, name) =>
          setOptions((current) =>
            current.map((item) => (item.value === option.value ? { ...item, label: name } : item)),
          )
        }
        itemActions={({ option, startRename }) => (
          <Button size="xs" onClick={startRename} aria-label={`Rename ${option.label}`}>
            Rename
          </Button>
        )}
      />
      <output aria-label="Searchable person value">{value}</output>
    </div>
  );
}
