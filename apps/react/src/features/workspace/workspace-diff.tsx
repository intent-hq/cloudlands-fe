import { isCommitHash } from './workspace-history-target';
import { WorkspaceGitFileAction } from './workspace-git-file-action';
import { Link } from '@tanstack/react-router';
import { useId, useLayoutEffect, useRef } from 'react';
import { store } from '@/store';
import { selectGitRead } from '@/store/git/git-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  gitReadRequested,
  releaseGitRead,
  gitReadsInvalidated,
} from '../../../../../src/store/renderer/slices/git/git-slice';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { m } from '$shared/paraglide/messages.js';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import { WorkspaceDiffRenderer } from './workspace-diff-renderer';

export function WorkspaceDiff({
  workspaceId,
  path,
  staged,
  commitHash,
  historyOrigin,
  query,
  fileQuery,
}: {
  workspaceId: string;
  path: string;
  staged: boolean;
  commitHash?: string;
  historyOrigin?: string;
  query?: string;
  fileQuery?: string;
}) {
  const consumerId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const read = selectGitRead(workspaceId, consumerId).value;
  const valid = parseWorkspaceFileTarget(path).valid && (!commitHash || isCommitHash(commitHash));
  useLayoutEffect(() => {
    title.current?.focus();
    if (!authority || !valid) return;
    let live = true;
    const requestId = crypto.randomUUID();
    const canRead = () =>
      live && authority === selectAdmittedWorkspaceReadContext.select(store.state, workspaceId);
    store.dispatch(
      gitReadRequested(
        workspaceId,
        consumerId,
        requestId,
        { kind: 'diffs', path, ...(commitHash ? { commitHash } : { staged }) },
        canRead,
      ),
    );
    return () => {
      live = false;
      store.dispatch(releaseGitRead(workspaceId, consumerId, requestId));
    };
  }, [workspaceId, path, staged, commitHash, authority, valid, consumerId]);
  const current =
    authority &&
    read?.request.kind === 'diffs' &&
    read.request.path === path &&
    (commitHash
      ? read.request.commitHash === commitHash
      : !read.request.commitHash && read.request.staged === staged)
      ? read
      : undefined;
  const chunks = current?.result?.kind === 'diffs' ? current.result.chunks : undefined;
  const chunk = chunks?.find((item) => item.file === path);
  return (
    <section
      className="grid min-w-0 gap-4"
      data-testid="workspace-diff"
      data-diff-path={path}
      data-diff-staged={commitHash ? undefined : staged}
      data-diff-commit={commitHash}
    >
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId }}
        search={{
          q: query || undefined,
          fileQuery: fileQuery || undefined,
          historyCommit: commitHash,
          historyOrigin,
        }}
        resetScroll={false}
        className="w-fit text-muted-foreground hover:text-foreground"
      >
        {m.workspace_transfer_back_label()}
      </Link>
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 ref={title} tabIndex={-1} className="type-heading-sm break-all">
            {path}
          </h2>
          <p className="break-all" data-diff-reference>
            {commitHash
              ? commitHash
              : staged
                ? m.workspace_fileChanges_staged_label()
                : m.workspace_fileChanges_unstaged_label()}
          </p>
        </div>
        {!commitHash && valid && authority && (
          <WorkspaceGitFileAction workspaceId={workspaceId} path={path} staged={staged} />
        )}
        <Button
          variant="outline"
          disabled={!authority || !valid || current?.loading}
          onClick={() => store.dispatch(gitReadsInvalidated(workspaceId))}
        >
          {current?.error
            ? m.ui_combobox_retry_label()
            : m.workspace_commitsTimeline_refresh_label()}
        </Button>
      </header>
      {!valid || !authority ? (
        <p role="alert">{m.fileExplorer_layout_loadFailed_error()}</p>
      ) : !current || current.loading ? (
        <LoadingState label={m.workspace_noteCodeChanges_loading_label()} />
      ) : current.error ? (
        <p role="alert">{current.error}</p>
      ) : !chunk ? (
        <p data-testid="git-diff-empty">{m.ui_diffViewer_empty_label()}</p>
      ) : chunk.isBinary || chunk.isTooLarge || !chunk.chunks.length ? (
        <p data-testid="git-diff-unavailable">{m.workspace_gitReview_unavailable_description()}</p>
      ) : (
        <WorkspaceDiffRenderer chunk={chunk} path={path} />
      )}
    </section>
  );
}
