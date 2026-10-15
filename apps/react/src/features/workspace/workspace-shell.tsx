import { Link, Outlet, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { SidebarExpandableSearch } from '@/components/workspace/sidebar/sidebar-expandable-search';
import { WorkspaceStatusIcon } from '@/components/workspace/workspace-status-icon';
import * as Sidebar from '@/components/ui/sidebar';
import { selectCurrentConnectionId } from '@/store/connections/connections-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceNavigationIds,
  selectWorkspaceListLoadedForBackend,
} from '@/store/workspace/workspace-selectors';
import { m } from '$shared/paraglide/messages.js';
import { resolveWorkspaceStatusState } from '$lib/components/workspace/utils/workspace-status-presentation';
import { WorkspaceReturnFocus } from './workspace-return-focus';
import type { HomeFilter } from '../../../../../src/features/home/home-model';
import { normalizeHomeConfiguration } from '../../../../../src/features/home/home-workspaces-persistence';

function WorkspaceNavigationRow({
  workspaceId,
  active,
  homeQuery,
  homeFilter,
}: {
  workspaceId: string;
  active: boolean;
  homeQuery?: string;
  homeFilter?: HomeFilter;
}) {
  const workspace = selectWorkspaceById(workspaceId);
  const sidebar = Sidebar.useSidebar();
  if (!workspace.value) return null;
  return (
    <Sidebar.MenuItem>
      <Sidebar.MenuButton asChild isActive={active}>
        <Link
          to="/workspaces/$workspaceId"
          params={{ workspaceId }}
          search={{ homeQuery, homeFilter }}
          data-navigation-workspace={workspaceId}
          onClick={(event) => {
            if (
              event.button === 0 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.shiftKey
            )
              sidebar.setOpenMobile(false);
          }}
        >
          <WorkspaceStatusIcon status={resolveWorkspaceStatusState(workspace.value)} />
          <span className="min-w-0 truncate">
            {workspace.value.title || m.workspace_links_untitled_label()}
          </span>
        </Link>
      </Sidebar.MenuButton>
    </Sidebar.MenuItem>
  );
}

export function WorkspaceShell() {
  const [query, setQuery] = useState('');
  const { workspaceId } = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const rawHomeQuery = workspaceId ? search.homeQuery : search.q;
  const homeQuery = typeof rawHomeQuery === 'string' ? rawHomeQuery : undefined;
  const homeFilter = normalizeHomeConfiguration({
    filter: workspaceId ? search.homeFilter : search.filter,
  }).filter;
  const returnFocus = useRef(workspaceId);
  useLayoutEffect(() => {
    if (workspaceId) returnFocus.current = workspaceId;
  }, [workspaceId]);
  const consumeReturnFocus = useCallback(() => {
    const id = returnFocus.current;
    returnFocus.current = undefined;
    return id;
  }, []);
  const backendId = selectCurrentConnectionId();
  const loaded = selectWorkspaceListLoadedForBackend(backendId);
  const ids = selectWorkspaceNavigationIds(query);
  return (
    <Sidebar.Provider persist={false}>
      <Sidebar.Root rail={false}>
        <Sidebar.Header
          orientation="horizontal"
          className="items-center gap-3 px-4 py-5 [&:has([data-sidebar-search-expanded])>span]:hidden"
        >
          <Logo />
          <span className="min-w-0 flex-1">{m.lib_commandPalette_workspaces_label()}</span>
          <SidebarExpandableSearch
            query={query}
            onQueryChange={setQuery}
            placeholder={m.layout_activeCard_search_placeholder()}
            scope="workspaces"
          />
        </Sidebar.Header>
        <Sidebar.Content>
          <nav
            aria-label={m.lib_commandPalette_workspaces_label()}
            data-testid="workspace-navigation"
          >
            <Sidebar.Group>
              {loaded.value && query.trim() && ids.value.length === 0 && (
                <output className="p-2 text-muted-foreground">
                  {m.ui_dropdown_noResults_label()}
                </output>
              )}
              <Sidebar.Menu>
                {loaded.value &&
                  ids.value.map((id) => (
                    <WorkspaceNavigationRow
                      key={id}
                      workspaceId={id}
                      active={id === workspaceId}
                      homeQuery={homeQuery}
                      homeFilter={homeFilter === 'all' ? undefined : homeFilter}
                    />
                  ))}
              </Sidebar.Menu>
            </Sidebar.Group>
          </nav>
        </Sidebar.Content>
      </Sidebar.Root>
      <Sidebar.Inset as="div" className="min-w-0">
        <WorkspaceReturnFocus value={consumeReturnFocus}>
          <Outlet />
        </WorkspaceReturnFocus>
      </Sidebar.Inset>
    </Sidebar.Provider>
  );
}
