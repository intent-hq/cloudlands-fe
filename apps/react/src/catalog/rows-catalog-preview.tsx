// Source: src/lib/component-catalog/renderers/RowsCatalogPreview.svelte.
// i18n-ignore (reference catalog fixture content)
import { useEffect, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { DotsThreeIcon, FolderIcon, RobotIcon, TrashIcon } from '@phosphor-icons/react';
import {
  DataList,
  ListRow,
  ListView,
  RowActions,
  SectionedList,
  type ListKey,
} from '@/components/patterns/collection';
import { SettingsFieldRow } from '@/components/patterns/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import * as Sidebar from '@/components/ui/sidebar';
import { SizeProvider } from '@/components/ui/size-context';
import * as Table from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import './rows-catalog-preview.css';

const baselineRows = Array.from({ length: 256 }, (_, index) => index);
const listItems = [
  { id: 'default', title: 'Default row', description: 'Supporting text' },
  { id: 'selected', title: 'Selected row', description: 'Merged selection surface' },
  {
    id: 'long',
    title: 'A deliberately long collection row title that truncates before its actions',
    description: 'Secondary text remains readable.',
  },
];
const sections = [{ id: 'recent', title: 'Recent work', items: listItems.slice(0, 2) }];
const dataItems = [
  { key: 'repository', label: 'Repository', value: 'intent-hq/cloudlands-fe' },
  { key: 'branch', label: 'Branch', value: 'system-design', description: 'Local preview branch' },
];
const actions = [
  { id: 'more', label: 'More details', icon: DotsThreeIcon },
  { id: 'delete', label: 'Delete row', icon: TrashIcon, destructive: true },
];
const workspaceRows = [
  { id: 'workspace-active', title: 'Active catalog workspace' },
  { id: 'workspace-unread', title: 'A very long unread workspace name that must truncate' },
];

export function RowsCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const location = useLocation();
  const showGrid = new URLSearchParams(location.searchStr).get('grid') === '1';
  const focusTarget = useRef<HTMLButtonElement>(null);
  const [selectedKeys, setSelectedKeys] = useState<ListKey[]>(['selected', 'long']);

  useEffect(() => {
    const frame = requestAnimationFrame(() => focusTarget.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="rows-matrix"
      data-baseline-grid={showGrid || undefined}
      data-catalog-renderer-fixture={fixture.id}
      data-catalog-rendered-state={fixture.states.join(' ')}
    >
      {showGrid && (
        <div className="baseline-overlay" aria-hidden="true">
          {baselineRows.map((index) => (
            <i key={index} />
          ))}
        </div>
      )}
      <section className="row-family" aria-labelledby="rows-list-row">
        <h3 id="rows-list-row" className="family-title">
          ListRow
        </h3>
        <div className="row-cell" data-row-preview="list-row-compositions">
          <ListRow
            leading={<FolderIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
            title="Workspace sources"
            description="Leading icon and secondary text"
            meta="2 files"
            trailing={<Badge variant="success">Ready</Badge>}
          />
          <ListRow
            leading={
              <Badge className="size-6 rounded-full p-1">
                <RobotIcon className="size-3" aria-hidden="true" />
              </Badge>
            }
            title="Avatar row"
            trailing={
              <RowActions
                actions={actions}
                alwaysVisible
                visibleCount={1}
                overflowLabel="More avatar-row actions"
              />
            }
          />
        </div>
        <div className="row-cell" data-row-preview="list-row-selection-states">
          <ListView
            items={listItems}
            getKey={(item) => item.id}
            getText={(item) => item.title}
            selectable="multi"
            selectedKeys={selectedKeys}
            onSelectedKeysChange={setSelectedKeys}
            ariaLabel="Collection row states"
            row={({ item }) => <ListRow title={item.title} description={item.description} />}
          />
        </div>
        <div className="row-cell" data-row-preview="list-row-loading-disabled">
          <ListView
            items={listItems.slice(0, 0)}
            status="loading"
            ariaLabel="Loading collection rows"
            row={({ item }) => <ListRow title={item.title} />}
          />
          <ListRow
            aria-disabled="true"
            className="opacity-50"
            title="Disabled row"
            trailing={<Badge>Loading</Badge>}
          />
        </div>
        <div className="row-cell" data-row-preview="list-row-compact">
          <SizeProvider size="compact">
            <ListRow title="Compact density" trailing={<Badge>28 px target</Badge>} />
          </SizeProvider>
        </div>
        <div className="row-cell zoom-preview" data-row-preview="list-row-zoom-200">
          <ListRow title="200% zoom" description="Content remains contained" />
        </div>
      </section>

      <section className="row-family" aria-labelledby="rows-sectioned-list">
        <h3 id="rows-sectioned-list" className="family-title">
          SectionedList
        </h3>
        <div className="row-cell" data-row-preview="sectioned-list">
          <SectionedList
            sections={sections}
            getKey={(section) => section.id}
            header={(section) => section.title}
          >
            {(section) =>
              section.items.map((item) => (
                <ListRow key={item.id} title={item.title} description={item.description} />
              ))
            }
          </SectionedList>
        </div>
      </section>

      <section className="row-family" aria-labelledby="rows-data-list">
        <h3 id="rows-data-list" className="family-title">
          DataList
        </h3>
        <div className="row-cell" data-row-preview="data-list">
          <DataList items={dataItems} />
        </div>
      </section>

      <section className="row-family" aria-labelledby="rows-table">
        <h3 id="rows-table" className="family-title">
          Table
        </h3>
        <div className="row-cell" data-row-preview="table-header-body-selected">
          <Table.Root aria-label="Workspace row comparison">
            <Table.Header>
              <Table.Row>
                <Table.Head>Workspace</Table.Head>
                <Table.Head>Status</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>Default row</Table.Cell>
                <Table.Cell>Idle</Table.Cell>
              </Table.Row>
              <Table.Row data-state="selected">
                <Table.Cell>Selected row</Table.Cell>
                <Table.Cell>Active</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      <section className="row-family" aria-labelledby="rows-sidebar">
        <h3 id="rows-sidebar" className="family-title">
          Sidebar rows
        </h3>
        <div className="row-cell bg-sidebar" data-row-preview="workspace-sidebar-rows">
          <Sidebar.Provider defaultOpen persist={false} className="min-h-0!">
            <Sidebar.Menu>
              {workspaceRows.map((workspace, index) => (
                <Sidebar.MenuItem key={workspace.id}>
                  <Sidebar.MenuButton
                    label={workspace.title}
                    status={index === 0 ? 'active' : 'unread'}
                    aria-label={workspace.title}
                  />
                  {index === 1 && <Sidebar.MenuBadge>1</Sidebar.MenuBadge>}
                </Sidebar.MenuItem>
              ))}
            </Sidebar.Menu>
          </Sidebar.Provider>
        </div>
        <div className="row-cell bg-sidebar" data-row-preview="agent-sidebar-rows">
          <Sidebar.Provider defaultOpen persist={false} className="min-h-0!">
            <Sidebar.Menu>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  label="Active catalog implementor"
                  status="active"
                  icon={<RobotIcon aria-hidden="true" />}
                />
              </Sidebar.MenuItem>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  label="A very long background agent name that must truncate"
                  icon={<RobotIcon aria-hidden="true" />}
                />
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Provider>
        </div>
        <div className="row-cell bg-sidebar" data-row-preview="sidebar-menu-states">
          <Sidebar.Provider defaultOpen persist={false} className="min-h-0!">
            <Sidebar.Menu>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton ref={focusTarget} label="Focused navigation" />
              </Sidebar.MenuItem>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton label="Current navigation" isActive status="active" />
              </Sidebar.MenuItem>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton label="Unread navigation" status="unread" />
                <Sidebar.MenuBadge>3</Sidebar.MenuBadge>
                <Sidebar.MenuAction showOnHover aria-label="Unread row actions">
                  ⋯
                </Sidebar.MenuAction>
              </Sidebar.MenuItem>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton label="Disabled navigation" disabled />
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Provider>
        </div>
      </section>

      <section className="row-family" aria-labelledby="rows-menu">
        <h3 id="rows-menu" className="family-title">
          Menu item rows
        </h3>
        <div className="row-cell" data-row-preview="menu-item-states">
          <Menu.Root defaultOpen staticPosition>
            <Menu.Content className="w-full">
              <Menu.Item>Default item</Menu.Item>
              <Menu.Item data-highlighted>Hover / highlighted</Menu.Item>
              <Menu.Item data-state="open">Active item</Menu.Item>
              <Menu.Item disabled>Disabled item</Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </div>
      </section>

      <section className="row-family" aria-labelledby="rows-settings">
        <h3 id="rows-settings" className="family-title">
          SettingsFieldRow
        </h3>
        <div className="row-cell" data-row-preview="settings-field-row-default-busy">
          <SettingsFieldRow
            id="rows-setting"
            label="Workspace notifications"
            description="Receive updates when a workspace needs attention."
            busy
            status="Saving changes"
          >
            <Button size="sm" loading>
              Saving
            </Button>
          </SettingsFieldRow>
        </div>
        <div className="row-cell" data-row-preview="settings-field-row-compact-disabled">
          <SettingsFieldRow
            id="rows-setting-compact"
            label="Compact disabled field"
            compact
            disabled
          >
            <Button size="sm" disabled>
              Unavailable
            </Button>
          </SettingsFieldRow>
        </div>
      </section>

      <section className="row-family tabs-family" aria-labelledby="rows-tabs">
        <h3 id="rows-tabs" className="family-title">
          Tab strip items
        </h3>
        <div className="row-cell" data-row-preview="panel-tab-strip">
          <Tabs defaultValue="file">
            <TabsList className="w-full justify-start overflow-hidden" aria-label="Panel tabs">
              <TabsTrigger value="note">Implementation plan</TabsTrigger>
              <TabsTrigger value="agent">Catalog implementor</TabsTrigger>
              <TabsTrigger value="file">RowsCatalogPreview.svelte</TabsTrigger>
              <TabsTrigger value="browser">Browser preview</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="row-cell" data-row-preview="workspace-tab-strip">
          <Tabs defaultValue="active">
            <TabsList className="w-full justify-start overflow-hidden" aria-label="Workspace tabs">
              <TabsTrigger value="active">Active workspace</TabsTrigger>
              <TabsTrigger value="unread">Unread workspace</TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                Disabled workspace
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="row-cell" data-row-preview="dragging-placeholder">
          <div className="drag-placeholder" aria-hidden="true" data-dragging-placeholder />
          <span className="sr-only">Dragging placeholder</span>
        </div>
      </section>
    </div>
  );
}
