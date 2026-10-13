import { Link, Outlet, useParams } from '@tanstack/react-router';
import { Logo } from '@/components/logo';
import * as Sidebar from '@/components/ui/sidebar';
import { selectCurrentConnectionId } from '@/store/connections/connections-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceIds,
  selectWorkspaceListLoadedForBackend,
} from '@/store/workspace/workspace-selectors';
import { m } from '$shared/paraglide/messages.js';

function WorkspaceNavigationRow({ workspaceId, active }: { workspaceId: string; active: boolean }) {
  const workspace = selectWorkspaceById(workspaceId);
  const sidebar = Sidebar.useSidebar();
  if (!workspace.value) return null;
  return (
    <Sidebar.MenuItem>
      <Sidebar.MenuButton asChild isActive={active}>
        <Link
          to="/workspaces/$workspaceId"
          params={{ workspaceId }}
          search={{}}
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
          <span className="min-w-0 truncate">{workspace.value.title}</span>
        </Link>
      </Sidebar.MenuButton>
    </Sidebar.MenuItem>
  );
}

export function WorkspaceShell() {
  const { workspaceId } = useParams({ strict: false });
  const backendId = selectCurrentConnectionId();
  const loaded = selectWorkspaceListLoadedForBackend(backendId);
  const ids = selectWorkspaceIds();
  return (
    <Sidebar.Provider persist={false}>
      <Sidebar.Root rail={false}>
        <Sidebar.Header orientation="horizontal" className="items-center gap-3 px-4 py-5">
          <Logo />
          <span>{m.lib_commandPalette_workspaces_label()}</span>
        </Sidebar.Header>
        <Sidebar.Content>
          <nav
            aria-label={m.lib_commandPalette_workspaces_label()}
            data-testid="workspace-navigation"
          >
            <Sidebar.Group>
              <Sidebar.Menu>
                {loaded.value &&
                  ids.value.map((id) => (
                    <WorkspaceNavigationRow key={id} workspaceId={id} active={id === workspaceId} />
                  ))}
              </Sidebar.Menu>
            </Sidebar.Group>
          </nav>
        </Sidebar.Content>
      </Sidebar.Root>
      <Sidebar.Inset as="div" className="min-w-0">
        <Outlet />
      </Sidebar.Inset>
    </Sidebar.Provider>
  );
}
