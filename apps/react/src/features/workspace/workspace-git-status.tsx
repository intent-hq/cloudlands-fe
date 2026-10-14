import { m } from '$shared/paraglide/messages.js';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
import { ListRow, ListView } from '@/components/patterns/collection';
import { LoadingState } from '@/components/patterns/screen';
import { ChangesRefreshAction } from '@/components/workspace/sidebar/changes-refresh-action';
import { HostExecutionNotice } from '@/features/providers/host-execution-notice';
import { store } from '@/store';
import { selectGitWorkspaceState } from '@/store/git/git-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { loadGitStatus } from '../../../../../src/store/renderer/slices/git/git-slice';

export function WorkspaceGitStatus({
  workspaceId,
  query,
}: {
  workspaceId: string;
  query?: string;
}) {
  const header = useRef<HTMLElement>(null);
  const restoreRefreshFocus = useRef(false);
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const state = selectGitWorkspaceState(workspaceId);
  const connection = authority.value;
  const { status, loading, error } = state.value;
  useLayoutEffect(() => {
    if (loading || !restoreRefreshFocus.current) return;
    restoreRefreshFocus.current = false;
    if (document.activeElement === document.body)
      header.current?.querySelector<HTMLButtonElement>('[data-changes-refresh]')?.focus();
  }, [loading]);
  if (!connection) return null;
  return (
    <section className="grid min-w-0 gap-3" data-testid="workspace-git-status">
      <header ref={header} className="flex items-center gap-3">
        <h2 tabIndex={-1} className="type-heading-sm flex-1">
          {m.workspace_sidebarChanges_rootChangedFiles_label()}
        </h2>
        <ChangesRefreshAction
          disabled={loading}
          onClick={() => {
            restoreRefreshFocus.current =
              document.activeElement === header.current?.querySelector('[data-changes-refresh]');
            store.dispatch(loadGitStatus(workspaceId, true));
          }}
        />
      </header>
      <HostExecutionNotice />
      <ListView
        items={status?.files ?? []}
        getKey={(file) => `${file.staged}:${file.path}`}
        status={error ? 'error' : loading || !status ? 'loading' : 'ready'}
        loading={<LoadingState label={m.workspace_noteCodeChanges_loading_label()} />}
        error={<p role="alert">{error}</p>}
        empty={
          <p className="text-muted-foreground">
            {m.workspace_sidebarChanges_rootNoChanges_label()}
          </p>
        }
        ariaLabel={m.workspace_sidebarChanges_rootChangedFiles_label()}
        row={({ item }) => (
          <Link
            to="/workspaces/$workspaceId"
            params={{ workspaceId }}
            search={{ file: item.path, q: query || undefined }}
            className="block min-w-0 rounded-md hover:bg-muted focus-visible:outline"
            data-file-path={item.path}
          >
            <ListRow
              title={
                <span className="block whitespace-normal break-all" data-git-path>
                  {item.path}
                </span>
              }
              description={
                item.staged
                  ? m.workspace_fileChanges_staged_label()
                  : m.workspace_fileChanges_unstaged_label()
              }
              trailing={<span data-git-status>{item.status}</span>}
              data-git-path={item.path}
              data-git-staged={item.staged}
            />
          </Link>
        )}
      />
    </section>
  );
}
