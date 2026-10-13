// i18n-ignore (internal unreleased read-only workspace preview)
import { Link, useNavigate } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { workspaceNotesHydrationRequested } from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { workspaceUnmounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { loadGitStatus } from '../../../../../src/store/renderer/slices/git/git-slice';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { WorkspaceStatusIcon } from '@/components/workspace/workspace-status-icon';
import { ResourceNotFound } from '@/components/common/resource-not-found';
import { resolveWorkspaceStatusState } from '$lib/components/workspace/utils/workspace-status-presentation';
import {
  Screen,
  ScreenHeader,
  ScreenBody,
  LoadingState,
  EmptyState,
} from '@/components/patterns/screen';
import {
  selectDaemonHealth,
  selectHasEverConnected,
} from '@/store/daemon-health/daemon-health-selectors';
import { buttonVariants } from '@/components/ui/button';
import { selectCurrentConnectionId } from '@/store/connections/connections-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceIds,
  selectWorkspaceListLoadedForBackend,
} from '@/store/workspace/workspace-selectors';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceNotes } from './workspace-notes';
import { WorkspaceProgress } from './workspace-progress';
import { WorkspaceGitStatus } from './workspace-git-status';
import { WorkspaceFile } from './workspace-file';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import {
  loadFileContentRequested,
  removeFileContentEntry,
} from '../../../../../src/store/renderer/slices/files/files-slice';

let nextHydrationGeneration = 0;

function WorkspaceReadiness() {
  const health = selectDaemonHealth();
  const connectedBefore = selectHasEverConnected();
  if (health.value === 'down' && connectedBefore.value)
    return (
      <EmptyState
        title={m.layout_daemonStatus_notConnected_description()}
        description={m.daemonStatus_overlay_retrying_label()}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Shared screen state renders a section; status announces connection recovery.
        role="status"
        data-testid="workspace-connection-lost"
      />
    );
  return <LoadingState label="Waiting for the daemon workspace list" />;
}

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
        <span className="flex min-w-0 items-center gap-2">
          <WorkspaceStatusIcon status={resolveWorkspaceStatusState(workspace.value)} />
          <span className="truncate">{workspace.value.title}</span>
        </span>
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
        leading={<SidebarTrigger />}
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
          <WorkspaceReadiness />
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
  filePath,
  line,
}: {
  workspaceId: string;
  noteId?: string;
  query?: string;
  filePath?: string;
  line?: number;
}) {
  const navigate = useNavigate();
  const backendId = selectCurrentConnectionId();
  const loaded = selectWorkspaceListLoadedForBackend(backendId);
  const workspace = selectWorkspaceById(workspaceId);
  const row = loaded.value ? workspace.value : undefined;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const connection = authority.value;
  const content = useRef<HTMLDivElement>(null);
  const previousFile = useRef({ workspaceId, filePath });
  useLayoutEffect(() => {
    const previous = previousFile.current;
    previousFile.current = { workspaceId, filePath };
    if (previous.workspaceId === workspaceId && previous.filePath && !filePath && !noteId) {
      const opener = content.current?.querySelector<HTMLAnchorElement>(
        `a[data-file-path="${CSS.escape(previous.filePath)}"]`,
      );
      (opener ?? content.current?.querySelector<HTMLElement>('h2'))?.focus();
    }
  }, [workspaceId, filePath, noteId]);
  useLayoutEffect(() => {
    if (!connection) return;
    store.dispatch(workspaceNotesHydrationRequested(workspaceId, ++nextHydrationGeneration, true));
    store.dispatch(loadGitStatus(workspaceId));
    return () => {
      store.dispatch(workspaceUnmounted(workspaceId));
    };
  }, [workspaceId, connection]);
  useLayoutEffect(() => {
    if (!connection || !filePath || !parseWorkspaceFileTarget(filePath).valid) return;
    store.dispatch(loadFileContentRequested(workspaceId, filePath, ''));
    return () => {
      store.dispatch(removeFileContentEntry(workspaceId, filePath));
    };
  }, [workspaceId, filePath, connection]);
  return (
    <Screen
      className="min-h-screen"
      data-testid="workspace-overview"
      data-workspace-id={workspaceId}
    >
      <ScreenHeader
        leading={<SidebarTrigger />}
        title={<h1>{row?.title ?? m.workspace_page_workspaceResource_label()}</h1>}
        description="Internal React preview · unreleased · read-only"
        actions={
          <Link to="/workspaces" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {m.lib_commandPalette_workspaces_label()}
          </Link>
        }
      />
      <ScreenBody className="grid content-start gap-6">
        {!loaded.value ? (
          <WorkspaceReadiness />
        ) : !row ? (
          <ResourceNotFound
            kind="not_found"
            resourceLabel={m.workspace_page_workspaceResource_label()}
            resourceId={workspaceId}
            headingLevel={2}
            onNavigateAway={() => void navigate({ to: '/workspaces' })}
          />
        ) : (
          <>
            {!noteId && !filePath && row.statusMessage && (
              <p data-testid="workspace-status-message">{row.statusMessage}</p>
            )}
            <dl className={noteId || filePath ? 'hidden' : 'grid min-w-0 gap-4 sm:grid-cols-3'}>
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
            <div key={workspaceId} ref={content} className="grid min-w-0 gap-6">
              {filePath ? (
                <WorkspaceFile
                  key={filePath}
                  workspaceId={workspaceId}
                  path={filePath}
                  line={line}
                  noteId={noteId}
                  query={query}
                />
              ) : (
                <>
                  {!noteId && <WorkspaceProgress workspaceId={workspaceId} query={query} />}
                  {!noteId && <WorkspaceGitStatus workspaceId={workspaceId} query={query} />}
                  <WorkspaceNotes
                    workspaceId={workspaceId}
                    noteId={noteId}
                    query={query}
                    onRetry={() =>
                      store.dispatch(
                        workspaceNotesHydrationRequested(
                          workspaceId,
                          ++nextHydrationGeneration,
                          true,
                        ),
                      )
                    }
                  />
                </>
              )}
            </div>
          </>
        )}
      </ScreenBody>
    </Screen>
  );
}
