// i18n-ignore (internal unreleased preview controls and sample content)
import { useRef, useState } from 'react';
import {
  CommandPaletteFilters,
  type CommandPaletteFiltersHandle,
} from '@/components/command-palette-filters';
import { CommandPaletteItemTitle } from '@/components/command-palette-item-title';
import { Logo } from '@/components/logo';
import { FormField } from '@/components/patterns/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { PaletteFilter } from '../../../../src/store/renderer/slices/command-palette/command-palette-utils';

const filters: Record<string, PaletteFilter> = {
  '@': 'agent',
  '#': 'note',
  '/': 'file',
  '*': 'workspace',
  '?': 'message',
  '~': 'change',
  '>': 'terminal',
  '^': 'browser',
};

export function CommandPaletteExamples() {
  const filterHandle = useRef<CommandPaletteFiltersHandle>(null);
  const [prefix, setPrefix] = useState('');
  const [label, setLabel] = useState('React migration');
  const [workspace, setWorkspace] = useState(true);
  const [collaborator, setCollaborator] = useState(false);
  const [archived, setArchived] = useState(false);
  const activeFilter = filters[prefix] ?? null;
  return (
    <section className="grid min-w-0 gap-6" data-testid="command-palette-demo">
      <header className="flex items-center gap-3">
        <Logo />
        <div>
          <h1>Command palette components</h1>
          <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
        </div>
      </header>
      <div className="grid min-w-0 gap-3">
        <FormField
          label="Result title"
          control={(field) => (
            <Input
              {...field}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault();
                  filterHandle.current?.cycle(event.shiftKey ? -1 : 1);
                }
              }}
            />
          )}
        />
        <p className="type-caption text-muted-foreground">
          Tab and Shift+Tab cycle filters while editing.
        </p>
        <div className="flex flex-wrap gap-4">
          <FormField
            label="Workspace options"
            control={(field) => (
              <Switch
                {...field}
                ariaLabel="Workspace options"
                checked={workspace}
                onCheckedChange={setWorkspace}
              />
            )}
          />
          <FormField
            label="Collaborator"
            control={(field) => (
              <Switch
                {...field}
                ariaLabel="Collaborator"
                checked={collaborator}
                onCheckedChange={setCollaborator}
              />
            )}
          />
          <FormField
            label="Archived workspace"
            control={(field) => (
              <Switch
                {...field}
                ariaLabel="Archived workspace"
                checked={archived}
                onCheckedChange={setArchived}
              />
            )}
          />
        </div>
      </div>
      <div className="min-w-0 rounded-lg bg-background p-3" data-testid="command-palette-frame">
        <CommandPaletteFilters
          ref={filterHandle}
          workspaceId={workspace ? 'preview' : undefined}
          activeFilter={activeFilter}
          isCollaborator={collaborator}
          onFilter={setPrefix}
        />
        <div className="grid gap-4 p-3">
          <CommandPaletteItemTitle
            item={{
              type: 'note',
              label,
              breadcrumbs: 'Plan / Integration',
              workspaceName: 'Intent',
              repoLabel: 'cloudlands-fe',
              isArchivedWorkspace: archived,
            }}
          />
          <CommandPaletteItemTitle
            item={{
              type: 'file',
              label: 'catalog-app.tsx',
              path: 'apps/react/src/catalog/catalog-app.tsx',
            }}
          />
        </div>
      </div>
      <output aria-label="Selected filter">{activeFilter ?? 'all'}</output>
    </section>
  );
}
