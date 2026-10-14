// i18n-ignore (internal unreleased component preview controls and caller values)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HomeWorkspaceControls } from '@/features/home/components/home-workspace-controls';
import { HomeWorkspaceSettings } from '@/features/home/components/home-workspace-settings';
import { defaultHomeConfiguration } from '../../../../src/features/home/home-workspaces-persistence';
import type { HomeWorkspacesState } from '../../../../src/features/home/home-workspaces-slice';
import { m } from '$shared/paraglide/messages.js';

export function HomeWorkspaceControlsExamples() {
  const [view, setView] = useState<HomeWorkspacesState>(() => ({
    ...defaultHomeConfiguration(),
    selectedId: 'selected-workspace',
    persistenceScope: null,
    persistenceError: false,
  }));
  const [hold, setHold] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [shown, setShown] = useState(true);
  const [retire, setRetire] = useState(false);
  const [events, setEvents] = useState<
    { changes: Partial<HomeWorkspacesState>; revision: string }[]
  >([]);
  const filters = [
    { id: 'all' as const, label: m.home_filter_all(), count: 12 },
    { id: 'attention' as const, label: m.home_filter_attention(), count: 3 },
    { id: 'running' as const, label: m.home_filter_running(), count: 2 },
    { id: 'blocked' as const, label: m.home_filter_blocked(), count: 1 },
    { id: 'unread' as const, label: m.home_filter_unread(), count: 4 },
  ];
  const change = (changes: Partial<HomeWorkspacesState>) => {
    setEvents((previous) => [...previous, { changes, revision: updated ? 'updated' : 'original' }]);
    if (!hold) setView((previous) => ({ ...previous, ...changes }));
    if (retire) setShown(false);
  };
  return (
    <section className="grid min-w-0 w-full gap-4" data-testid="home-workspace-controls-demo">
      <header>
        <h2>Home workspace toolbar</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={hold} onClick={() => setHold(!hold)}>
          Hold changes
        </Button>
        <Button variant="outline" onClick={() => setUpdated(!updated)}>
          Replace callbacks
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on change
        </Button>
        <Button variant="outline" onClick={() => setShown(true)}>
          Show toolbar
        </Button>
      </div>
      <div className="home-panel min-w-0" data-testid="home-workspace-controls-frame">
        {shown && (
          <div className="flex shrink-0 flex-nowrap items-center gap-3 overflow-x-auto px-6 py-4">
            <HomeWorkspaceControls
              query={view.query}
              filter={view.filter}
              view={view.view}
              filters={filters}
              onquery={(query) => change({ query })}
              onfilter={(filter) => change({ filter })}
              onview={(nextView) => change({ view: nextView })}
              settings={<HomeWorkspaceSettings view={view} onChange={change} />}
            />
          </div>
        )}
      </div>
      <Button variant="outline">After toolbar</Button>
      <output aria-label="Home toolbar state" className="min-w-0 break-words">
        {JSON.stringify({
          query: view.query,
          filter: view.filter,
          view: view.view,
          groupBy: view.groupBy,
          updatedWithin: view.updatedWithin,
          selectedId: view.selectedId,
        })}
      </output>
      <output aria-label="Home toolbar callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
