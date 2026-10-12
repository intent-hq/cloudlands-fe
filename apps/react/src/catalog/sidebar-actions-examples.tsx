// i18n-ignore (deterministic internal catalog controls and callback records, not product copy)
// Source oracles: SidebarActionIconsHarness, SidebarExpandableSearch, composite-focus CT.
import { useCallback, useState } from 'react';
import { ContentDialog } from '@/components/patterns/confirm';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChangesRefreshAction } from '@/components/workspace/sidebar/changes-refresh-action';
import { SidebarActionIcon } from '@/components/workspace/sidebar/sidebar-action-icon';
import { SidebarExpandableSearch } from '@/components/workspace/sidebar/sidebar-expandable-search';
import { SidebarGroupHeader } from '@/components/workspace/sidebar/sidebar-group-header';
import { SidebarHeaderAction } from '@/components/workspace/sidebar/sidebar-header-action';
import { m } from '$shared/paraglide/messages.js';

type Scope = 'agents' | 'context' | 'files';
type RecordValue = string | number | boolean | null;
type CallbackRecord = { callback: string; [key: string]: RecordValue };

export function SidebarActionsExamples() {
  const [scope, setScope] = useState<Scope>('agents');
  const [placement, setPlacement] = useState<'header' | 'toolbar'>('header');
  const [query, setQuery] = useState('');
  const [externalQuery, setExternalQuery] = useState('external search');
  const [expanded, setExpanded] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([]);
  const record = useCallback((entry: CallbackRecord) => {
    setCallbacks((current) => [...current, entry]);
  }, []);
  const actionRef = useCallback(
    (node: HTMLButtonElement | null) => record({ callback: 'header-ref', attached: node !== null }),
    [record],
  );
  const placeholder = {
    agents: m.workspace_multiSelectSidebar_searchAgents_placeholder(),
    context: m.workspace_multiSelectSidebar_searchContext_placeholder(),
    files: m.workspace_multiSelectSidebar_searchFiles_placeholder(),
  }[scope];

  const exercise = (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      data-testid="sidebar-actions-host"
    >
      <FormField
        label="Search scope"
        control={(field) => (
          <ToggleGroup
            id={field.id}
            type="single"
            aria-label="Search scope"
            className="min-w-0 flex-wrap justify-start"
            value={scope}
            onValueChange={(value) => {
              if (value === 'agents' || value === 'context' || value === 'files') setScope(value);
            }}
          >
            {(['agents', 'context', 'files'] as const).map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {value}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      />
      <FormField
        label="Search placement"
        control={(field) => (
          <ToggleGroup
            id={field.id}
            type="single"
            aria-label="Search placement"
            className="min-w-0 flex-wrap justify-start"
            value={placement}
            onValueChange={(value) => {
              if (value === 'header' || value === 'toolbar') setPlacement(value);
            }}
          >
            <ToggleGroupItem value="header">header</ToggleGroupItem>
            <ToggleGroupItem value="toolbar">toolbar</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <FormField
        label="External query prop"
        control={(field) => (
          <Input
            {...field}
            value={externalQuery}
            onChange={(event) => setExternalQuery(event.currentTarget.value)}
          />
        )}
      />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button onClick={() => setQuery(externalQuery)}>Apply external query</Button>
        <Button onClick={() => setQuery('')}>Clear external query</Button>
      </div>
      <FormField
        label="Refresh disabled and busy"
        control={(field) => (
          <Switch
            {...field}
            ariaLabel="Refresh disabled and busy"
            checked={disabled}
            onCheckedChange={setDisabled}
          />
        )}
      />
      <FormField
        label="Mount sidebar leaves"
        control={(field) => (
          <Switch
            {...field}
            ariaLabel="Mount sidebar leaves"
            checked={mounted}
            onCheckedChange={setMounted}
          />
        )}
      />
      {mounted && (
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          data-testid="sidebar-leaves"
          onFocusCapture={(event) =>
            record({
              callback: 'focus',
              target: event.target.getAttribute('aria-label') ?? event.target.tagName,
            })
          }
        >
          <div
            className="flex min-w-0 flex-wrap items-center gap-2"
            data-testid="sidebar-icon-leaves"
          >
            <SidebarActionIcon icon="plus" />
            <SidebarActionIcon icon="search" />
            <SidebarActionIcon icon="close" />
          </div>
          {(['Context', 'Changes', 'Files'] as const).map((title) => (
            <div
              key={title}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-sidebar p-3"
              data-sidebar-fixture={title}
            >
              <span className="min-w-0 type-body font-medium">{title}</span>
              <div className="flex shrink-0 items-center gap-1">
                {title !== 'Changes' && (
                  <SidebarHeaderAction
                    icon="search"
                    label={m.workspace_multiSelectSidebar_searchContext_placeholder()}
                    onClick={(event) =>
                      record({
                        callback: 'header-action',
                        title,
                        icon: 'search',
                        eventType: event.type,
                        detail: event.detail,
                      })
                    }
                  />
                )}
                {title === 'Context' && (
                  <SidebarHeaderAction
                    ref={actionRef}
                    icon="plus"
                    label={m.menu_new_note()}
                    onClick={(event) =>
                      record({
                        callback: 'header-action',
                        title,
                        icon: 'plus',
                        eventType: event.type,
                        detail: event.detail,
                      })
                    }
                  />
                )}
                <SidebarHeaderAction
                  icon="close"
                  label={m.ui_tab_close_ariaLabel()}
                  onClick={(event) =>
                    record({
                      callback: 'header-action',
                      title,
                      icon: 'close',
                      eventType: event.type,
                      detail: event.detail,
                    })
                  }
                />
              </div>
            </div>
          ))}
          <SidebarGroupHeader
            title="Fixture group"
            meta="3"
            expanded={expanded}
            onClick={() => {
              record({ callback: 'group-toggle', expanded: !expanded });
              setExpanded(!expanded);
            }}
          />
          {expanded && <p data-testid="sidebar-group-content">Caller-controlled group content</p>}
          <div
            className="flex min-w-0 items-center gap-2"
            style={{ containerType: 'inline-size' }}
            data-testid="sidebar-search-host"
          >
            <SidebarExpandableSearch
              query={query}
              onQueryChange={(next) => {
                setQuery(next);
                record({ callback: 'query', value: next });
              }}
              placeholder={placeholder}
              scope={scope}
              placement={placement}
              onKeydown={(event) =>
                record({
                  callback: 'keydown',
                  key: event.key,
                  native: event instanceof KeyboardEvent,
                  defaultPrevented: event.defaultPrevented,
                })
              }
            />
            <ChangesRefreshAction
              disabled={disabled}
              onClick={() => record({ callback: 'refresh' })}
            />
          </div>
        </div>
      )}
      <Button onClick={() => record({ callback: 'blur-target' })}>Focus after search</Button>
    </div>
  );

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      data-functional-example="sidebar-actions"
    >
      <h2>Sidebar action and search callbacks</h2>
      <p className="type-caption text-muted-foreground">
        Internal caller-prop exercise. Refresh uses the source’s single disabled/busy prop; actions
        only record callbacks. Native focus, appearance and services remain unverified.
      </p>
      <Button onClick={() => setDialogOpen(true)}>Open sidebar dialog</Button>
      {!dialogOpen && exercise}
      <ContentDialog
        open={dialogOpen}
        title="Sidebar search parent"
        onOpenChange={(open) => {
          setDialogOpen(open);
          record({ callback: 'dialog-open', open });
        }}
        onClose={() => record({ callback: 'dialog-close' })}
      >
        {dialogOpen && exercise}
      </ContentDialog>
      <output
        aria-label="Sidebar callback state"
        className="block min-w-0 whitespace-pre-wrap wrap-anywhere"
        data-testid="sidebar-callback-state"
      >
        {JSON.stringify(
          { scope, placement, query, disabled, expanded, mounted, dialogOpen, callbacks },
          null,
          2,
        )}
      </output>
    </section>
  );
}
