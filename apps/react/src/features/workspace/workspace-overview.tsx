// i18n-ignore (internal unreleased read-only workspace preview)
import { Link } from '@tanstack/react-router';
import { useLayoutEffect } from 'react';
import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { workspaceNotesHydrationRequested } from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { workspaceUnmounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { loadGitStatus } from '../../../../../src/store/renderer/slices/git/git-slice';
import { Logo } from '@/components/logo';
import { Screen, ScreenHeader, ScreenBody, LoadingState } from '@/components/patterns/screen';
import { buttonVariants } from '@/components/ui/button';
import { selectCurrentConnectionId } from '@/store/connections/connections-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceIds,
  selectWorkspaceListLoadedForBackend,
} from '@/store/workspace/workspace-selectors';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceNotes } from './workspace-notes';
import { WorkspaceGitStatus } from './workspace-git-status';

let nextHydrationGeneration = 0;

function WorkspaceRow({ workspaceId }: { workspaceId: string }) {
  const workspace = selectWorkspaceById(workspaceId);
  if (!workspace.value) return null;
  return (
    <li>
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId }}
        className="flex min-w-0 flex-col gap-1 rounded-md px-3 py-3 hover:bg-muted focus-visible:outline"
      >
        <span className="truncate">{workspace.value.title}</span>
        {workspace.value.statusMessage && (
          <span className="type-caption text-muted-foreground">
            {workspace.value.statusMessage}
          </span>
        )}
      </Link>
    </li>
  );
}

export function WorkspaceList() {
  const backendId = selectCurrentConnectionId();
  const loaded = selectWorkspaceListLoadedForBackend(backendId);
  const ids = selectWorkspaceIds();
  return (
    <Screen className="min-h-screen" data-testid="workspace-list">
      <ScreenHeader
        leading={<Logo />}
        title={<h1>{m.lib_commandPalette_workspaces_label()}</h1>}
        description="Internal React preview · unreleased · read-only"
        actions={
          <Link to="/sandbox" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Component sandbox
          </Link>
        }
      />
      <ScreenBody>
        {!loaded.value ? (
          <LoadingState label="Waiting for the daemon workspace list" />
        ) : ids.value.length === 0 ? (
          <p>No workspaces on this daemon.</p>
        ) : (
          <ul className="grid gap-1">
            {ids.value.map((id) => (
              <WorkspaceRow key={id} workspaceId={id} />
            ))}
          </ul>
        )}
      </ScreenBody>
    </Screen>
  );
}

export function WorkspaceOverview({
  workspaceId,
  noteId,
  query,
}: {
  workspaceId: string;
  noteId?: string;
  query?: string;
}) {
  const backendId = selectCurrentConnectionId();
  const loaded = selectWorkspaceListLoadedForBackend(backendId);
  const workspace = selectWorkspaceById(workspaceId);
  const row = loaded.value ? workspace.value : undefined;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const connection = authority.value;
  useLayoutEffect(() => {
    if (!connection) return;
    store.dispatch(workspaceNotesHydrationRequested(workspaceId, ++nextHydrationGeneration, true));
    store.dispatch(loadGitStatus(workspaceId));
    return () => {
      store.dispatch(workspaceUnmounted(workspaceId));
    };
  }, [workspaceId, connection]);
  return (
    <Screen
      className="min-h-screen"
      data-testid="workspace-overview"
      data-workspace-id={workspaceId}
    >
      <ScreenHeader
        leading={<Logo />}
        title={<h1>{row?.title}</h1>}
        description="Internal React preview · unreleased · read-only"
        actions={
          <Link to="/workspaces" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {m.lib_commandPalette_workspaces_label()}
          </Link>
        }
      />
      <ScreenBody className="grid content-start gap-6">
        {!loaded.value ? (
          <LoadingState label="Waiting for the daemon workspace list" />
        ) : !row ? (
          <p>This workspace is not available on the connected daemon.</p>
        ) : (
          <>
            {!noteId && row.statusMessage && (
              <p data-testid="workspace-status-message">{row.statusMessage}</p>
            )}
            <dl className={noteId ? 'hidden' : 'grid min-w-0 gap-4 sm:grid-cols-3'}>
              <div>
                <dt className="type-caption text-muted-foreground">Repository</dt>
                <dd data-testid="workspace-repository">{row.repositoryName}</dd>
              </div>
              <div>
                <dt className="type-caption text-muted-foreground">Branch</dt>
                <dd className="break-all" data-testid="workspace-branch">
                  {row.branch}
                </dd>
              </div>
              <div>
                <dt className="type-caption text-muted-foreground">Status</dt>
                <dd data-testid="workspace-status">{row.status}</dd>
              </div>
            </dl>
            {!noteId && <WorkspaceGitStatus workspaceId={workspaceId} />}
            <WorkspaceNotes workspaceId={workspaceId} noteId={noteId} query={query} />
          </>
        )}
      </ScreenBody>
    </Screen>
  );
}
