import { WorkspaceCommitHistory } from './workspace-commit-history';
import { WorkspaceDiff } from './workspace-diff';
import { matchingGitDiffOrigin } from './workspace-diff-target';
import { WorkspaceCreate } from './workspace-create';
import { useWorkspaceViewLifetime } from './workspace-view-lifetime';
import type { ConversationFileOrigin } from './workspace-file-origin';
import { selectFileAbsolutePath, selectFileReadContext } from '@/store/files/files-selectors';
// i18n-ignore (internal unreleased workspace preview)
import { Link, useNavigate } from '@tanstack/react-router';
import { useContext, useLayoutEffect, useRef } from 'react';
import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { workspaceNotesHydrationRequested } from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { loadGitStatus } from '../../../../../src/store/renderer/slices/git/git-slice';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { HomeWorkspaceStatus } from '@/features/home/components/home-workspace-status';
import { HomeActivityTime } from '@/features/home/components/home-activity-time';
import { ResourceNotFound } from '@/components/common/resource-not-found';
import { HomeSearch } from '@/features/home/components/home-search';
import { HomeFilterSelect } from '@/features/home/components/home-filter-select';
import type { HomeFilter } from '../../../../../src/features/home/home-model';
import { HomeLoading } from '@/features/home/components/home-loading';
import { Screen, ScreenHeader, ScreenBody, EmptyState } from '@/components/patterns/screen';
import {
  selectDaemonHealth,
  selectHasEverConnected,
} from '@/store/daemon-health/daemon-health-selectors';
import { buttonVariants } from '@/components/ui/button';
import { selectCurrentConnectionId } from '@/store/connections/connections-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceIds,
  selectHomeWorkspaceIds,
  selectWorkspaceListLoadedForBackend,
} from '@/store/workspace/workspace-selectors';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceNotes } from './workspace-notes';
import { WorkspaceProgress } from './workspace-progress';
import { WorkspaceAgents } from './workspace-agents';
import { WorkspaceConversation } from './workspace-conversation';
import { WorkspaceGitStatus } from './workspace-git-status';
import { WorkspaceFile } from './workspace-file';
import { WorkspaceReturnFocus } from './workspace-return-focus';
import { WorkspaceContentLoading } from './workspace-content-loading';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import {
  loadFileContentRequested,
  removeFileContentEntry,
} from '../../../../../src/store/renderer/slices/files/files-slice';

let nextHydrationGeneration = 0;

function WorkspaceReadiness({ list = false }: { list?: boolean }) {
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
  return list ? <HomeLoading /> : <WorkspaceContentLoading />;
}

function WorkspaceRow({
  workspaceId,
  query,
  filter,
}: {
  workspaceId: string;
  query: string;
  filter: HomeFilter;
}) {
  const workspace = selectWorkspaceById(workspaceId);
  if (!workspace.value) return null;
  return (
    <li className="flex min-w-0 items-center gap-3">
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId }}
        search={{
          homeQuery: query || undefined,
          homeFilter: filter === 'all' ? undefined : filter,
        }}
        data-list-workspace={workspaceId}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-md px-3 py-3 hover:bg-muted focus-visible:outline"
      >
        <span className="flex min-w-0 items-center gap-2">
          <HomeWorkspaceStatus workspace={workspace.value} />
          <span className="truncate">{workspace.value.title}</span>
        </span>
        {workspace.value.statusMessage && (
          <span className="type-caption text-muted-foreground">
            {workspace.value.statusMessage}
          </span>
        )}
      </Link>
      <span
        className="type-caption shrink-0 pr-3 text-muted-foreground"
        data-workspace-activity={workspaceId}
      >
        <HomeActivityTime workspace={workspace.value} />
      </span>
    </li>
  );
}

export function WorkspaceList({
  query = '',
  filter = 'all',
}: {
  query?: string;
  filter?: HomeFilter;
}) {
  const navigate = useNavigate();
  const backendId = selectCurrentConnectionId();
  const loaded = selectWorkspaceListLoadedForBackend(backendId);
  const allIds = selectWorkspaceIds();
  const ids = selectHomeWorkspaceIds(query, filter);
  const list = useRef<HTMLElement>(null);
  const consumeReturnFocus = useContext(WorkspaceReturnFocus);
  useLayoutEffect(() => {
    if (!loaded.value) return;
    const id = consumeReturnFocus?.();
    if (!id || document.activeElement !== document.body) return;
    const opener = list.current?.querySelector<HTMLAnchorElement>(
      `a[data-list-workspace="${CSS.escape(id)}"]`,
    );
    (opener ?? list.current?.querySelector<HTMLInputElement>('input[type="search"]'))?.focus();
  }, [loaded.value, consumeReturnFocus]);
  const changeSearch = (q: string, nextFilter: HomeFilter) =>
    void navigate({
      to: '/workspaces',
      search: {
        ...(q ? { q } : {}),
        ...(nextFilter !== 'all' ? { filter: nextFilter } : {}),
      },
      replace: true,
      resetScroll: false,
    });
  return (
    <Screen ref={list} className="min-h-screen" data-testid="workspace-list">
      <ScreenHeader
        leading={<SidebarTrigger />}
        title={<h1>{m.lib_commandPalette_workspaces_label()}</h1>}
        description={m.settings_gitWorkspace_experimental_badge()}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceCreate />
            <Link to="/sandbox" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Component sandbox
            </Link>
          </div>
        }
      />
      <ScreenBody className="grid content-start gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <HomeSearch
            value={query}
            onchange={(value) => changeSearch(value, filter)}
            placeholder={m.layout_activeCard_search_placeholder()}
            className="min-w-40 flex-1"
          />
          <div className="max-w-full shrink-0">
            <HomeFilterSelect
              value={filter}
              label={m.layout_allCard_status_label()}
              options={[
                { value: 'all', label: m.home_filter_all() },
                { value: 'attention', label: m.home_filter_attention() },
                { value: 'running', label: m.home_filter_running() },
                { value: 'blocked', label: m.home_filter_blocked() },
                { value: 'unread', label: m.home_filter_unread() },
                { value: 'archived', label: m.home_filter_archived() },
              ]}
              onchange={(value) => changeSearch(query, value as HomeFilter)}
            />
          </div>
        </div>
        {!loaded.value ? (
          <WorkspaceReadiness list />
        ) : allIds.value.length === 0 ? (
          <p>No workspaces on this daemon.</p>
        ) : ids.value.length === 0 ? (
          <output>{m.ui_dropdown_noResults_label()}</output>
        ) : (
          <ul className="grid gap-1">
            {ids.value.map((id) => (
              <WorkspaceRow key={id} workspaceId={id} query={query} filter={filter} />
            ))}
          </ul>
        )}
      </ScreenBody>
    </Screen>
  );
}

export function WorkspaceOverview({
  workspaceId,
  agentId,
  messageId,
  noteId,
  query,
  filePath,
  diffPath,
  diffStaged = false,
  diffOrigin,
  commitDiff,
  historyCommit,
  historyOrigin,
  fileOrigin,
  attachmentId,
  attachmentAgentId,
  line,
  fileQuery,
  homeQuery,
  homeFilter,
}: {
  workspaceId: string;
  agentId?: string;
  messageId?: string;
  noteId?: string;
  query?: string;
  filePath?: string;
  diffPath?: string;
  diffStaged?: boolean;
  diffOrigin?: string;
  commitDiff?: string;
  historyCommit?: string;
  historyOrigin?: string;
  fileOrigin?: ConversationFileOrigin;
  attachmentId?: string;
  attachmentAgentId?: string;
  line?: number;
  fileQuery?: string;
  homeQuery?: string;
  homeFilter?: HomeFilter;
}) {
  const navigate = useNavigate();
  const backendId = selectCurrentConnectionId();
  const loaded = selectWorkspaceListLoadedForBackend(backendId);
  const workspace = selectWorkspaceById(workspaceId);
  const row = loaded.value ? workspace.value : undefined;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const connection = authority.value;
  useWorkspaceViewLifetime(workspaceId, loaded.value && !row);
  const fileAuthority = selectFileReadContext(
    workspaceId,
    attachmentId ? (attachmentAgentId ?? '') : undefined,
  ).value;
  const title = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previousWorkspace = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (previousWorkspace.current === workspaceId) return;
    const firstEntry = previousWorkspace.current === undefined;
    previousWorkspace.current = workspaceId;
    if (
      !agentId &&
      !noteId &&
      !filePath &&
      !diffPath &&
      (firstEntry || !document.activeElement?.matches('[data-navigation-workspace]'))
    )
      title.current?.focus();
  }, [workspaceId, agentId, noteId, filePath, diffPath]);
  const previousAgent = useRef(agentId);
  useLayoutEffect(() => {
    const previous = previousAgent.current;
    previousAgent.current = agentId;
    if (previous && !agentId && !noteId && !filePath) title.current?.focus();
  }, [agentId, noteId, filePath]);
  const previousDiff = useRef({
    workspaceId,
    path: diffPath,
    staged: diffStaged,
    origin: diffOrigin,
  });
  useLayoutEffect(() => {
    const previous = previousDiff.current;
    previousDiff.current = { workspaceId, path: diffPath, staged: diffStaged, origin: diffOrigin };
    if (
      previous.workspaceId !== workspaceId ||
      !previous.path ||
      diffPath ||
      filePath ||
      agentId ||
      noteId
    )
      return;
    const opener =
      content.current?.querySelector<HTMLAnchorElement>(
        `a[data-git-row="${CSS.escape(`${previous.staged}:${previous.path}`)}"]`,
      ) ??
      content.current?.querySelector<HTMLAnchorElement>(
        `a[data-git-row="${CSS.escape(`${!previous.staged}:${previous.path}`)}"]`,
      );
    if (!opener) return;
    const origin = matchingGitDiffOrigin(
      previous.origin,
      workspaceId,
      previous.path,
      previous.staged,
    );
    opener.focus({ preventScroll: true });
    if (origin)
      window.scrollBy({ top: opener.getBoundingClientRect().y - origin.y, behavior: 'instant' });
    else opener.scrollIntoView({ block: 'center' });
  }, [workspaceId, diffPath, diffStaged, diffOrigin, filePath, agentId, noteId]);
  const previousFile = useRef({ workspaceId, filePath });
  useLayoutEffect(() => {
    const previous = previousFile.current;
    previousFile.current = { workspaceId, filePath };
    if (
      previous.workspaceId === workspaceId &&
      previous.filePath &&
      !filePath &&
      !diffPath &&
      !noteId
    ) {
      const opener = content.current?.querySelector<HTMLAnchorElement>(
        `a[data-file-path="${CSS.escape(previous.filePath)}"]`,
      );
      (opener ?? content.current?.querySelector<HTMLElement>('h2'))?.focus();
    }
  }, [workspaceId, filePath, noteId, diffPath]);
  useLayoutEffect(() => {
    if (!connection) return;
    store.dispatch(workspaceNotesHydrationRequested(workspaceId, ++nextHydrationGeneration, true));
    store.dispatch(loadGitStatus(workspaceId));
  }, [workspaceId, connection]);
  const fileAbsolutePath = selectFileAbsolutePath(workspaceId, filePath).value;
  useLayoutEffect(() => {
    if (!fileAuthority || !filePath || !parseWorkspaceFileTarget(filePath).valid) return;
    store.dispatch(
      loadFileContentRequested(
        workspaceId,
        filePath,
        fileAbsolutePath,
        attachmentId
          ? {
              readOnlyPreview: true,
              attachment: { id: attachmentId, agentId: attachmentAgentId ?? '' },
            }
          : undefined,
      ),
    );
    return () => {
      store.dispatch(removeFileContentEntry(workspaceId, filePath));
    };
  }, [workspaceId, filePath, fileAuthority, fileAbsolutePath, attachmentId, attachmentAgentId]);
  return (
    <Screen
      className="min-h-screen"
      data-testid="workspace-overview"
      data-workspace-id={workspaceId}
    >
      <ScreenHeader
        leading={<SidebarTrigger />}
        title={
          <h1 ref={title} tabIndex={-1}>
            {row?.title ?? m.workspace_page_workspaceResource_label()}
          </h1>
        }
        description={m.settings_gitWorkspace_experimental_badge()}
        actions={
          <Link
            to="/workspaces"
            search={{ q: homeQuery || undefined, filter: homeFilter }}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
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
            onNavigateAway={() =>
              void navigate({
                to: '/workspaces',
                search: { q: homeQuery || undefined, filter: homeFilter },
              })
            }
          />
        ) : (
          <>
            {!agentId && !noteId && !filePath && !diffPath && row.statusMessage && (
              <p data-testid="workspace-status-message">{row.statusMessage}</p>
            )}
            <dl
              className={
                agentId || noteId || filePath || diffPath
                  ? 'hidden'
                  : 'grid min-w-0 gap-4 sm:grid-cols-3'
              }
            >
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
              {agentId ? (
                <WorkspaceConversation
                  key={agentId}
                  workspaceId={workspaceId}
                  agentId={agentId}
                  messageId={messageId}
                />
              ) : diffPath ? (
                <WorkspaceDiff
                  workspaceId={workspaceId}
                  path={diffPath}
                  staged={diffStaged}
                  commitHash={commitDiff}
                  historyOrigin={historyOrigin}
                  query={query}
                  fileQuery={fileQuery}
                />
              ) : filePath ? (
                <WorkspaceFile
                  key={filePath}
                  workspaceId={workspaceId}
                  path={filePath}
                  origin={fileOrigin}
                  attachmentId={attachmentId}
                  attachmentAgentId={attachmentAgentId}
                  line={line}
                  noteId={noteId}
                  query={query}
                  fileQuery={fileQuery}
                />
              ) : (
                <>
                  {!noteId && (
                    <WorkspaceProgress
                      workspaceId={workspaceId}
                      query={query}
                      fileQuery={fileQuery}
                    />
                  )}
                  {!noteId && <WorkspaceAgents workspaceId={workspaceId} />}
                  {!noteId && (
                    <WorkspaceGitStatus
                      workspaceId={workspaceId}
                      query={query}
                      fileQuery={fileQuery}
                    />
                  )}
                  <WorkspaceNotes
                    workspaceId={workspaceId}
                    noteId={noteId}
                    query={query}
                    fileQuery={fileQuery}
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
              {!agentId && !noteId && !filePath && (
                <WorkspaceCommitHistory
                  workspaceId={workspaceId}
                  query={query}
                  fileQuery={fileQuery}
                  expandedHash={historyCommit}
                  origin={historyOrigin}
                  hidden={Boolean(diffPath)}
                />
              )}
            </div>
          </>
        )}
      </ScreenBody>
    </Screen>
  );
}
