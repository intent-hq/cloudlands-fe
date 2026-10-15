import { useRef, useState } from 'react';
import { FileIcon } from '@phosphor-icons/react';
import { ExpandableFileSearch } from '@/components/workspace/sidebar/expandable-file-search';
import { ListContainer, ListItem } from '@/components/ui/list';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import {
  selectFileExplorerContext,
  selectFileSearch,
} from '@/store/file-explorer/file-explorer-selectors';
import { fileSearchRequested } from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import { workspaceRelativeFilePath } from '../../../../../src/features/file/utils/workspace-file-path';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import { m } from '$shared/paraglide/messages.js';

/** Only focus and DOM resources are local; the shared explorer owns each search. */
export function WorkspaceFileFinder({
  workspaceId,
  consumerId,
  context,
  root,
  onOpen,
}: {
  workspaceId: string;
  consumerId: string;
  context: string;
  root: string;
  onOpen: (path: string) => void;
}) {
  const search = selectFileSearch(workspaceId, consumerId, context).value;
  const host = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string>();
  const valid = (path: string) => {
    const relative = workspaceRelativeFilePath(path, root);
    return relative === path && parseWorkspaceFileTarget(path).valid;
  };
  const invalid = search?.settled && search.paths.some((path) => !valid(path));
  const paths = search?.settled && !search.error && !invalid ? search.paths : [];
  const activePath = paths.includes(focused ?? '') ? focused : paths[0];
  const current = () =>
    selectFileExplorerContext.select(store.state, workspaceId) === context
      ? selectFileSearch.select(store.state, workspaceId, consumerId, context)
      : undefined;
  function request(query: string) {
    if (!current()) return;
    store.dispatch(
      fileSearchRequested(workspaceId, consumerId, crypto.randomUUID(), query, context),
    );
  }
  function open(path: string) {
    const latest = current();
    if (
      !latest?.settled ||
      latest.error ||
      latest.requestId !== search?.requestId ||
      !latest.paths.includes(path) ||
      !valid(path)
    )
      return;
    onOpen(path);
  }
  function focus(index: number) {
    const path = paths[Math.max(0, Math.min(index, paths.length - 1))];
    if (!path) return;
    setFocused(path);
    host.current?.querySelector<HTMLElement>(`[data-finder-path="${CSS.escape(path)}"]`)?.focus();
  }
  return (
    <div ref={host} className="mb-3 min-w-0" data-testid="workspace-file-finder">
      <ExpandableFileSearch
        query={search?.query ?? ''}
        onQueryChange={request}
        onKeydown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!paths.length) return;
            event.preventDefault();
            focus(event.key === 'ArrowDown' ? 0 : paths.length - 1);
          } else if (event.key === 'Enter' && activePath) {
            event.preventDefault();
            open(activePath);
          }
        }}
      />
      {Boolean(search?.query.trim()) && (
        <div className="mt-3 min-w-0">
          {!search?.settled ? (
            <LoadingState recipe="list" label={m.ui_spinner_loading_ariaLabel()} />
          ) : search.error || invalid ? (
            <div className="flex items-center gap-2">
              <p role="alert" className="type-caption break-all">
                {invalid ? m.workspace_fileFinder_invalid_error() : search.error}
              </p>
              <Button variant="ghost" size="sm" onClick={() => request(search.query)}>
                {m.fileExplorer_treeView_retry_label()}
              </Button>
            </div>
          ) : (
            <>
              {search.truncated && (
                <p className="mb-2 type-caption text-muted-foreground">
                  {m.workspace_fileFinder_limited_description()}
                </p>
              )}
              {paths.length === 0 ? (
                <p>{m.ui_dropdown_noResults_label()}</p>
              ) : (
                <ListContainer
                  aria-label={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
                  spacing="compact"
                >
                  {paths.map((path, index) => (
                    <ListItem
                      key={path}
                      title={path}
                      icon={FileIcon}
                      size="sm"
                      data-finder-path={path}
                      tabIndex={activePath === path ? 0 : -1}
                      onFocus={() => setFocused(path)}
                      onClick={() => open(path)}
                      onKeyDown={(event) => {
                        if (
                          event.altKey ||
                          event.ctrlKey ||
                          event.metaKey ||
                          event.nativeEvent.isComposing
                        )
                          return;
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                          event.preventDefault();
                          focus(index + (event.key === 'ArrowDown' ? 1 : -1));
                        } else if (event.key === 'Home' || event.key === 'End') {
                          event.preventDefault();
                          focus(event.key === 'Home' ? 0 : paths.length - 1);
                        }
                      }}
                    />
                  ))}
                </ListContainer>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
