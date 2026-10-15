import { useId, useLayoutEffect, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/patterns/collection';
import { TimelineSection } from '@/components/workspace/sidebar/timeline-section';
import { TimelineDivider } from '@/components/workspace/sidebar/timeline-divider';
import { LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import { selectWorkspaceHistory } from '@/store/changes/commit-history-selectors';
import { selectGitRead } from '@/store/git/git-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  refreshRequested,
  loadMoreCommitsRequested,
  loadOlderCommitsRequested,
} from '../../../../../src/store/renderer/slices/changes/changes-slice';
import {
  gitReadRequested,
  releaseGitRead,
  gitReadsInvalidated,
} from '../../../../../src/store/renderer/slices/git/git-slice';
import { m } from '$shared/paraglide/messages.js';
import { formatDateTime } from '$lib/i18n/format';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import { parseHistoryOrigin } from './workspace-history-target';

function CommitFiles({
  workspaceId,
  hash,
  query,
  fileQuery,
  hidden,
  origin,
}: {
  workspaceId: string;
  hash: string;
  query?: string;
  fileQuery?: string;
  hidden: boolean;
  origin?: string;
}) {
  const consumer = useId();
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const read = selectGitRead(workspaceId, consumer).value;
  const navigate = useNavigate();
  const element = useRef<HTMLDivElement>(null);
  const restored = useRef<string | undefined>(undefined);
  const clickedOrigin = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!authority) return;
    let live = true;
    const id = crypto.randomUUID();
    const current = () =>
      live && authority === selectAdmittedWorkspaceReadContext.select(store.state, workspaceId);
    store.dispatch(
      gitReadRequested(
        workspaceId,
        consumer,
        id,
        { kind: 'commitDetails', commitHash: hash },
        current,
      ),
    );
    return () => {
      live = false;
      store.dispatch(releaseGitRead(workspaceId, consumer, id));
    };
  }, [workspaceId, hash, consumer, authority]);
  const current =
    authority && read?.request.kind === 'commitDetails' && read.request.commitHash === hash
      ? read
      : undefined;
  const details = current?.result?.kind === 'commitDetails' ? current.result.details : undefined;
  useLayoutEffect(() => {
    if (hidden) {
      restored.current = undefined;
      return;
    }
    const returnOrigin = clickedOrigin.current ?? origin;
    if (!returnOrigin || current?.loading || !details || restored.current === returnOrigin) return;
    const target = parseHistoryOrigin(returnOrigin);
    if (target?.workspaceId !== workspaceId || target.hash !== hash) return;
    const opener = element.current?.querySelector<HTMLAnchorElement>(
      `a[data-history-file="${CSS.escape(target.path)}"]`,
    );
    if (!opener) return;
    restored.current = returnOrigin;
    opener.focus({ preventScroll: true });
    window.scrollBy({ top: opener.getBoundingClientRect().y - target.y, behavior: 'instant' });
  }, [hidden, origin, current?.loading, details, workspaceId, hash]);
  return (
    <div ref={element} className="grid min-w-0 gap-2" data-history-details={hash}>
      {!current || current.loading ? (
        <LoadingState label={m.workspace_noteCodeChanges_loading_label()} />
      ) : current.error ? (
        <p role="alert">{current.error}</p>
      ) : !details || (!details.author && !details.message && !details.files.length) ? (
        <p>{m.workspace_gitReview_unavailable_description()}</p>
      ) : (
        <>
          <code className="break-all" data-history-sha>
            {details.commitHash}
          </code>
          <p className="whitespace-pre-wrap break-words" data-history-message>
            {details.message}
          </p>
          <p className="type-caption text-muted-foreground">
            {details.author}
            {details.date ? ` · ${formatDateTime(details.date)}` : ''}
          </p>
          <ul className="grid min-w-0 gap-1">
            {details.files.map((path) => (
              <li key={path}>
                {parseWorkspaceFileTarget(path).valid ? (
                  <Link
                    to="/workspaces/$workspaceId"
                    params={{ workspaceId }}
                    search={{
                      q: query || undefined,
                      fileQuery: fileQuery || undefined,
                      historyCommit: hash,
                      commitDiff: hash,
                      diff: path,
                    }}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.altKey ||
                        event.shiftKey
                      )
                        return;
                      event.preventDefault();
                      const returnOrigin = JSON.stringify({
                        workspaceId,
                        hash,
                        path,
                        y: event.currentTarget.getBoundingClientRect().y,
                      });
                      clickedOrigin.current = returnOrigin;
                      void navigate({
                        to: '/workspaces/$workspaceId',
                        params: { workspaceId },
                        search: {
                          q: query || undefined,
                          fileQuery: fileQuery || undefined,
                          historyCommit: hash,
                          commitDiff: hash,
                          diff: path,
                          historyOrigin: returnOrigin,
                        },
                        resetScroll: false,
                      });
                    }}
                    className="block rounded-md hover:bg-muted focus-visible:outline"
                    data-history-file={path}
                  >
                    <ListRow title={<span className="whitespace-normal break-all">{path}</span>} />
                  </Link>
                ) : (
                  <span className="break-all">{path}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {current?.error && (
        <Button variant="outline" onClick={() => store.dispatch(gitReadsInvalidated(workspaceId))}>
          {m.ui_combobox_retry_label()}
        </Button>
      )}
    </div>
  );
}

export function WorkspaceCommitHistory({
  workspaceId,
  query,
  fileQuery,
  expandedHash,
  origin,
  hidden = false,
}: {
  workspaceId: string;
  query?: string;
  fileQuery?: string;
  expandedHash?: string;
  origin?: string;
  hidden?: boolean;
}) {
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const state = selectWorkspaceHistory(workspaceId).value;
  const navigate = useNavigate();
  useLayoutEffect(() => {
    if (authority) store.dispatch(refreshRequested(workspaceId));
  }, [workspaceId, authority]);
  const current = state.history.context === authority ? state : undefined;
  const row = (commit: (typeof state.commits)[number]) => (
    <div key={commit.hash} data-history-entry={commit.hash} className="min-w-0">
      <p className="break-words">{commit.message.split('\n')[0]}</p>
      <TimelineSection
        title={commit.hash.slice(0, 12)}
        collapsible
        expanded={expandedHash === commit.hash}
        onToggle={() =>
          void navigate({
            to: '/workspaces/$workspaceId',
            params: { workspaceId },
            search: {
              q: query || undefined,
              fileQuery: fileQuery || undefined,
              historyCommit: expandedHash === commit.hash ? undefined : commit.hash,
            },
            replace: true,
            resetScroll: false,
          })
        }
      >
        <div data-history-row={commit.hash} className="grid min-w-0 gap-2">
          <p className="type-caption text-muted-foreground break-all">
            {commit.author}
            {commit.timestamp ? ` · ${formatDateTime(commit.timestamp)}` : ''}
          </p>
          {expandedHash === commit.hash && (
            <CommitFiles
              workspaceId={workspaceId}
              hash={commit.hash}
              query={query}
              fileQuery={fileQuery}
              hidden={hidden}
              origin={origin}
            />
          )}
        </div>
      </TimelineSection>
    </div>
  );
  return (
    <section hidden={hidden} className="min-w-0 space-y-3" data-testid="workspace-commit-history">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-heading-sm">{m.workspace_commitsTimeline_commits_label()}</h2>
        <Button
          variant="outline"
          disabled={
            !authority || current?.history.current.loading || current?.history.older.loading
          }
          onClick={() => store.dispatch(refreshRequested(workspaceId))}
        >
          {m.workspace_commitsTimeline_refresh_label()}
        </Button>
      </header>
      {!authority ? (
        <p role="alert">{m.fileExplorer_layout_loadFailed_error()}</p>
      ) : !current || (!current.history.current.loaded && current.history.current.loading) ? (
        <LoadingState label={m.workspace_noteCodeChanges_loading_label()} />
      ) : (
        <>
          {current.history.current.error && <p role="alert">{current.history.current.error}</p>}
          {current.commits.map(row)}
          {current.history.current.loaded && !current.commits.length && (
            <p>{m.workspace_sidebarChanges_rootNoCommits_label()}</p>
          )}
          {current.history.current.nextToken && (
            <Button
              variant="outline"
              data-history-more
              disabled={current.history.current.loading}
              onClick={() => store.dispatch(loadMoreCommitsRequested(workspaceId))}
            >
              {current.history.current.loading
                ? m.workspace_noteCodeChanges_loading_label()
                : m.workspace_sidebarChanges_rootShowMoreCommits_label()}
            </Button>
          )}
          {current.boundarySha && (
            <TimelineDivider>
              <span
                className="bg-background type-caption break-all"
                data-history-boundary={current.boundarySha}
              >
                {m.workspace_commitsTimeline_workspaceStart_label()}{' '}
                <code>{current.boundarySha}</code>
              </span>
            </TimelineDivider>
          )}
          {current.older.map(row)}
          {current.history.older.error && <p role="alert">{current.history.older.error}</p>}
          {current.boundarySha &&
            (!current.history.older.loaded ||
              current.history.older.nextToken ||
              current.history.older.error) && (
              <Button
                variant="outline"
                data-history-older
                disabled={current.history.older.loading || current.history.current.loading}
                onClick={() =>
                  store.dispatch(loadOlderCommitsRequested(workspaceId, current.boundarySha!, 20))
                }
              >
                {current.history.older.loading
                  ? m.workspace_noteCodeChanges_loading_label()
                  : m.workspace_commitsTimeline_showMorePrevious_label()}
              </Button>
            )}
        </>
      )}
    </section>
  );
}
