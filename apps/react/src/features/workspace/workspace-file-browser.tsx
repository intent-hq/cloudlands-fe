import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CaretDownIcon, CaretRightIcon, FileIcon } from '@phosphor-icons/react';
import { ListContainer, ListItem } from '@/components/ui/list';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import {
  selectFileExplorerContext,
  selectFileExplorerRoot,
  selectFileExplorerRows,
  selectFileExplorerState,
} from '@/store/file-explorer/file-explorer-selectors';
import {
  initializeFileExplorer,
  refreshFileExplorer,
  refreshDirectoryRequested,
  retireFileExplorer,
  toggleDirectoryRequested,
} from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import type { FlattenedFileNode } from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-types';
import { workspaceRelativeFilePath } from '../../../../../src/features/file/utils/workspace-file-path';
import { nextFileTreeIndex, parentFileTreeIndex } from '$lib/utils/file-tree-navigation';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceFileFinder } from './workspace-file-finder';
import { selectFileSearch } from '@/store/file-explorer/file-explorer-selectors';
import {
  fileSearchOpened,
  fileSearchReleased,
} from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';

/** Read-only primary-root host. Canonical explorer owns nodes, ordering and expansion. */
export function WorkspaceFileBrowser({
  workspaceId,
  hidden,
  query,
  fileQuery,
}: {
  workspaceId: string;
  hidden: boolean;
  query?: string;
  fileQuery?: string;
}) {
  const context = selectFileExplorerContext(workspaceId).value;
  const root = selectFileExplorerRoot(workspaceId).value;
  return (
    <WorkspaceFileBrowserScope
      key={JSON.stringify([workspaceId, context])}
      workspaceId={workspaceId}
      hidden={hidden}
      query={query}
      fileQuery={fileQuery}
      context={context}
      root={root}
    />
  );
}

function WorkspaceFileBrowserScope({
  workspaceId,
  hidden,
  query,
  fileQuery,
  context,
  root,
}: {
  workspaceId: string;
  hidden: boolean;
  query?: string;
  fileQuery?: string;
  context: string | null;
  root: string;
}) {
  const navigate = useNavigate();
  const [consumerId] = useState(() => crypto.randomUUID());
  const search = selectFileSearch(workspaceId, consumerId, context ?? undefined).value;
  const state = selectFileExplorerState(workspaceId).value;
  const rows = selectFileExplorerRows(workspaceId).value;
  const host = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState<string>();
  const opened = useRef<{
    path: string;
    y: number;
    context: string;
    kind: 'explorer' | 'finder';
  } | null>(null);
  const wasHidden = useRef(hidden);

  useLayoutEffect(() => {
    opened.current = null;
    if (context) store.dispatch(fileSearchOpened(workspaceId, consumerId, context));
    return () => {
      store.dispatch(fileSearchReleased(workspaceId, consumerId));
      store.dispatch(retireFileExplorer(workspaceId));
    };
  }, [workspaceId, context, consumerId]);
  useLayoutEffect(() => {
    if (context && !hidden)
      store.dispatch(initializeFileExplorer(workspaceId, { workspacePath: root }));
  }, [workspaceId, context, root, hidden]);
  useLayoutEffect(() => {
    const returning = wasHidden.current && !hidden;
    wasHidden.current = hidden;
    const origin = opened.current;
    if (!returning || !origin || origin.context !== context) return;
    const opener = host.current?.querySelector<HTMLElement>(
      `[data-${origin.kind}-path="${CSS.escape(origin.path)}"]`,
    );
    if (!opener) return;
    opener.focus({ preventScroll: true });
    let active = true;
    const restore = () => {
      if (
        !active ||
        document.activeElement !== opener ||
        opened.current !== origin ||
        selectFileExplorerContext.select(store.state, workspaceId) !== context
      )
        return;
      window.scrollBy({ top: opener.getBoundingClientRect().y - origin.y, behavior: 'instant' });
    };
    restore();
    // Returning sibling panels may finish hydration after this commit. Keep the
    // focused row anchored until the user takes over scrolling or navigation.
    const frame = requestAnimationFrame(restore);
    const observer = new ResizeObserver(restore);
    observer.observe(document.body);
    if (host.current?.parentElement) observer.observe(host.current.parentElement);
    const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    const stop = () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const event of interactions) window.removeEventListener(event, stop, true);
      opener.removeEventListener('blur', stop);
    };
    for (const event of interactions)
      window.addEventListener(event, stop, { capture: true, passive: true });
    opener.addEventListener('blur', stop);
    return stop;
  }, [hidden, context, workspaceId]);

  function activate(row: FlattenedFileNode) {
    if (!context || selectFileExplorerContext.select(store.state, workspaceId) !== context) return;
    if (row.node.type === 'directory') {
      store.dispatch(toggleDirectoryRequested(workspaceId, row.node.path));
      return;
    }
    openFile(row.node.path, 'explorer');
  }
  function openFile(rawPath: string, kind: 'explorer' | 'finder') {
    if (!context || selectFileExplorerContext.select(store.state, workspaceId) !== context) return;
    const path = workspaceRelativeFilePath(rawPath, root);
    if (!path || !parseWorkspaceFileTarget(path).valid) return;
    const element = host.current?.querySelector<HTMLElement>(
      `[data-${kind}-path="${CSS.escape(rawPath)}"]`,
    );
    opened.current = { path: rawPath, y: element?.getBoundingClientRect().y ?? 0, context, kind };
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId },
      search: { file: path, q: query || undefined, fileQuery: fileQuery || undefined },
    });
  }
  function focusIndex(index: number) {
    const row = rows[index];
    if (!row) return;
    setFocused(row.node.path);
    host.current
      ?.querySelector<HTMLElement>(`[data-explorer-path="${CSS.escape(row.node.path)}"]`)
      ?.focus();
  }
  function keydown(event: KeyboardEvent<HTMLButtonElement>, row: FlattenedFileNode, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        focusIndex(nextFileTreeIndex(rows, index, event.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Home':
      case 'End':
        event.preventDefault();
        focusIndex(event.key === 'Home' ? 0 : rows.length - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row.node.type === 'directory' && row.isExpanded) {
          if (rows[index + 1]?.depth > row.depth) focusIndex(index + 1);
        } else activate(row);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.node.type === 'directory' && row.isExpanded) activate(row);
        else focusIndex(parentFileTreeIndex(rows, index));
        break;
    }
  }
  const current = context && state.workspacePath === root;
  const activePath = rows.some((row) => row.node.path === focused) ? focused : rows[0]?.node.path;
  return (
    <section ref={host} hidden={hidden} className="min-w-0" data-testid="workspace-file-browser">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="type-heading-sm">{m.fileExplorer_sidebar_files_label()}</h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={!context || state.isLoading}
          onClick={() =>
            store.dispatch(
              state.rootPath
                ? refreshFileExplorer(workspaceId)
                : initializeFileExplorer(workspaceId, { workspacePath: root }),
            )
          }
        >
          {m.fileExplorer_sidebar_refresh_tooltip()}
        </Button>
      </div>
      <p className="mb-3 type-caption text-muted-foreground">
        {m.workspace_fileBrowser_scope_description()}
      </p>
      {context && (
        <WorkspaceFileFinder
          workspaceId={workspaceId}
          consumerId={consumerId}
          context={context}
          root={root}
          onOpen={(path) => openFile(path, 'finder')}
        />
      )}
      {search?.query.trim() ? null : !context ? (
        <p role="alert">{m.fileExplorer_layout_loadFailed_error()}</p>
      ) : !current || (!state.isInitialized && !state.error) ? (
        <LoadingState recipe="list" label={m.ui_spinner_loading_ariaLabel()} />
      ) : (
        <>
          {state.error && <p role="alert">{state.error}</p>}
          {state.isLoading && <LoadingState label={m.ui_spinner_loading_ariaLabel()} />}
          {rows.length === 0 && !state.error && !state.isLoading && (
            <p>{m.fileExplorer_treeView_noFiles_label()}</p>
          )}
          <ListContainer
            role="tree"
            aria-label={m.fileExplorer_sidebar_files_label()}
            spacing="compact"
          >
            {rows.map((row, index) => {
              const error = state.directoryErrors?.[row.node.path];
              const directory = row.node.type === 'directory';
              return (
                <div key={row.node.path} role="none">
                  <ListItem
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-expanded={directory ? row.isExpanded : undefined}
                    aria-busy={row.isLoading || undefined}
                    tabIndex={activePath === row.node.path ? 0 : -1}
                    data-explorer-path={row.node.path}
                    title={row.displayPath || row.node.name}
                    indent={row.depth}
                    size="sm"
                    loading={row.isLoading}
                    icon={directory ? (row.isExpanded ? CaretDownIcon : CaretRightIcon) : FileIcon}
                    onFocus={() => setFocused(row.node.path)}
                    onClick={() => activate(row)}
                    onKeyDown={(event) => keydown(event, row, index)}
                  />
                  {directory &&
                    row.isExpanded &&
                    !row.isLoading &&
                    (error ? (
                      <div className="flex items-center gap-2 px-3">
                        <p role="alert" className="type-caption break-all">
                          {error}
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            store.dispatch(
                              refreshDirectoryRequested(workspaceId, `${row.node.path}/`),
                            )
                          }
                        >
                          {m.fileExplorer_treeView_retry_label()}
                        </Button>
                      </div>
                    ) : row.node.children.length === 0 ? (
                      <p className="px-3 py-1 type-caption text-muted-foreground">
                        {m.workspace_fileBrowser_empty_label()}
                      </p>
                    ) : null)}
                </div>
              );
            })}
          </ListContainer>
        </>
      )}
    </section>
  );
}
