import { selectIsWorkspaceHydrated } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { observeDesktopFileTreeRetirement } from '@/store/file-explorer/sagas/desktop-file-tree-lifetime';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  CaretDownIcon,
  CaretRightIcon,
  PlusIcon,
  PencilSimpleIcon,
  ArrowsInIcon,
  ArrowsOutIcon,
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ListContainer, ListItem } from '@/components/ui/list';
import { SidebarHeaderAction } from '@/components/workspace/sidebar/sidebar-header-action';
import { ExpandableFileSearch } from '@/components/workspace/sidebar/expandable-file-search';
import {
  SidebarContextMenu,
  getSidebarContextPosition,
  type SidebarContextPosition,
  type SidebarMenuEntry,
} from '@/components/ui/sidebar-context-menu';
import { ErrorState, LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectCurrentWorkspaceTabId } from '@/store/tab-state/tab-state-selectors';
import {
  selectFileExplorerContext,
  selectFileExplorerRoot,
  selectFileExplorerState,
  selectFileSearch,
  selectDesktopFileExplorerRows,
  selectDesktopFileExplorerGitStatus,
  selectDesktopFileExplorerSelectedPath,
} from '@/store/file-explorer/file-explorer-selectors';
import {
  initializeFileExplorer,
  retireFileExplorer,
  toggleDirectoryRequested,
  removeExpandedPath,
  expandToPathRequested,
  expandAllRequested,
  clearExpandedPathsExceptRoot,
  fileSearchOpened,
  fileSearchRequested,
  fileSearchReleased,
} from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import { loadGitStatus } from '../../../../../src/store/renderer/slices/git/git-slice';
import { getFileTypeIconSvg } from '$lib/utils/file-type-icons';
import { nextFileTreeIndex, parentFileTreeIndex } from '$lib/utils/file-tree-navigation';
import { workspaceRelativeFilePath } from '../../../../../src/features/file/utils/workspace-file-path';
import { m } from '$shared/paraglide/messages.js';
import { openDesktopFile } from './desktop-file-open';
import './desktop-files.css';

/** Source FilesPanel/VirtualizedFileTree presentation; records and reads keep their canonical owners. */
export function DesktopFiles({
  workspaceId,
  active,
  visible,
  onClose,
  onUnavailable,
}: {
  workspaceId: string;
  active: boolean;
  visible: boolean;
  onClose: () => void;
  onUnavailable: (label: string) => void;
}) {
  const consumer = useId();
  const hydrated = selectIsWorkspaceHydrated(workspaceId).value;
  const context = selectFileExplorerContext(workspaceId).value;
  const root = selectFileExplorerRoot(workspaceId).value;
  const state = selectFileExplorerState(workspaceId).value;
  const workspace = selectWorkspaceById(workspaceId).value;
  const selected = selectDesktopFileExplorerSelectedPath(workspaceId).value;
  const [query, setQuery] = useState('');
  const searchQuery = query.trim();
  const [changedOnly, setChangedOnly] = useState(false);
  const rows = selectDesktopFileExplorerRows(workspaceId, changedOnly).value;
  const git = selectDesktopFileExplorerGitStatus(workspaceId).value;
  const search = selectFileSearch(workspaceId, consumer, context ?? undefined).value;
  const [focused, setFocused] = useState<string | null>(null);
  const [searchNavigation, setSearchNavigation] = useState({ identity: '', index: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [menu, setMenu] = useState<(SidebarContextPosition & { path: string | null }) | null>(null);
  const tree = useRef<HTMLDivElement>(null);
  const searchResults = useRef<HTMLDivElement>(null);
  const typeahead = useRef({
    text: '',
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const [epoch, setEpoch] = useState(0);
  const lease = JSON.stringify([context, root, active, visible, epoch, hydrated]);
  const mounted = useRef<typeof lease | null>(null);
  useLayoutEffect(() => {
    mounted.current = lease;
    return () => {
      if (mounted.current === lease) mounted.current = null;
    };
  }, [lease]);
  useLayoutEffect(() => {
    if (
      !context ||
      !hydrated ||
      selectFileExplorerContext.select(store.state, workspaceId) !== context ||
      !selectIsWorkspaceHydrated.select(store.state, workspaceId)
    )
      return;
    return store.runSaga(function* () {
      yield* observeDesktopFileTreeRetirement(workspaceId, context, () => {
        if (mounted.current === lease) mounted.current = null;
        setEpoch((value) => value + 1);
      });
    });
  }, [workspaceId, context, lease, hydrated]);
  function current() {
    return (
      mounted.current === lease &&
      active &&
      hydrated &&
      visible &&
      !!context &&
      !!root &&
      selectCurrentWorkspaceTabId.select(store.state) === workspaceId &&
      selectFileExplorerContext.select(store.state, workspaceId) === context
    );
  }
  useLayoutEffect(() => {
    if (!context || !root) return;
    store.dispatch(fileSearchOpened(workspaceId, consumer, context));
    return () => {
      store.dispatch(fileSearchReleased(workspaceId, consumer));
      store.dispatch(retireFileExplorer(workspaceId));
    };
  }, [workspaceId, consumer, context, root]);
  useLayoutEffect(() => {
    if (!active || !visible || !context || !root || !hydrated) return;
    const currentState = selectFileExplorerState.select(store.state, workspaceId);
    if (!currentState.isInitialized && !currentState.isLoading && !currentState.error)
      store.dispatch(initializeFileExplorer(workspaceId, { workspacePath: root, workspaceId }));
    store.dispatch(loadGitStatus(workspaceId));
  }, [workspaceId, active, visible, context, root, epoch, hydrated]);
  useLayoutEffect(() => {
    if (!active || !visible || !context) return;
    store.dispatch(
      fileSearchRequested(
        workspaceId,
        consumer,
        crypto.randomUUID(),
        searchQuery,
        context ?? undefined,
      ),
    );
  }, [workspaceId, consumer, context, active, visible, searchQuery, epoch]);
  useLayoutEffect(() => () => clearTimeout(typeahead.current.timer), []);
  useLayoutEffect(() => {
    const element = tree.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (element.clientHeight > 0) setHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [searchQuery, state.isInitialized]);
  const lastReveal = useRef('');
  useLayoutEffect(() => {
    if (
      !active ||
      !visible ||
      searchQuery ||
      !context ||
      !selected ||
      !state.isInitialized ||
      state.isLoading
    )
      return;
    const key = `${context}:${selected}`;
    if (lastReveal.current === key) return;
    lastReveal.current = key;
    store.dispatch(expandToPathRequested(workspaceId, selected));
  }, [
    workspaceId,
    active,
    visible,
    context,
    selected,
    searchQuery,
    state.isInitialized,
    state.isLoading,
  ]);
  useLayoutEffect(() => {
    if (!selected || !visible || searchQuery) return;
    const index = rows.findIndex((row) => row.node.path === selected);
    if (index < 0 || !tree.current) return;
    const element = tree.current;
    if (
      index * 25 < element.scrollTop ||
      (index + 1) * 25 > element.scrollTop + element.clientHeight
    )
      element.scrollTop = Math.max(0, index * 25 - element.clientHeight / 2 + 12.5);
  }, [selected, rows, visible, searchQuery]);
  const results = (search?.paths ?? []).filter(
    (path) => !changedOnly || !!git[workspaceRelativeFilePath(path, root) ?? path],
  );
  const resultIdentity = results.join('\0');
  const searchIdentity = `${search?.requestId}:${search?.settled}:${resultIdentity}`;
  const searchIndex = searchNavigation.identity === searchIdentity ? searchNavigation.index : 0;
  function setSearchIndex(value: number | ((index: number) => number)) {
    setSearchNavigation((current) => ({
      identity: searchIdentity,
      index:
        typeof value === 'number'
          ? value
          : value(current.identity === searchIdentity ? current.index : 0),
    }));
  }
  useLayoutEffect(() => {
    if (active && visible && searchQuery)
      searchResults.current
        ?.querySelector('[data-search-selected=true]')
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, visible, searchQuery, searchIndex, resultIdentity]);
  function reveal(index: number) {
    const row = rows[index];
    if (!row) return;
    setFocused(row.node.path);
    const element = tree.current;
    if (element) {
      if (index * 25 < element.scrollTop) element.scrollTop = index * 25;
      else if ((index + 1) * 25 > element.scrollTop + element.clientHeight)
        element.scrollTop = (index + 1) * 25 - element.clientHeight;
    }
  }
  function toggle(path: string) {
    if (!current()) return;
    const row = selectDesktopFileExplorerRows
      .select(store.state, workspaceId)
      .find((row) => row.node.path === path);
    if (row?.node.type !== 'directory') return;
    if (row.isExpanded && row.compactedExpandedPaths?.length) {
      for (const expandedPath of row.compactedExpandedPaths)
        store.dispatch(removeExpandedPath(workspaceId, expandedPath));
    } else store.dispatch(toggleDirectoryRequested(workspaceId, path));
  }
  function open(path: string, adjacent = false, searching = false) {
    if (!current()) return;
    const admitted = searching
      ? selectFileSearch
          .select(store.state, workspaceId, consumer, context ?? undefined)
          ?.paths.includes(path)
      : selectDesktopFileExplorerRows
          .select(store.state, workspaceId)
          .some((row) => row.node.path === path && row.node.type === 'file');
    if (!admitted || !workspaceRelativeFilePath(path, root)) return;
    openDesktopFile(workspaceId, path, current, {
      filePathIsLiteral: true,
      openInAdjacentPanel: adjacent,
    });
  }
  function unavailable(label: string) {
    if (current()) onUnavailable(label);
  }
  function onKey(event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>, fromSearch = false) {
    if (
      !current() ||
      ('nativeEvent' in event ? event.nativeEvent.isComposing : event.isComposing) ||
      event.defaultPrevented
    )
      return;
    if (fromSearch && searchQuery) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSearchIndex((index) =>
          Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))),
        );
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (results[searchIndex]) open(results[searchIndex], event.metaKey || event.ctrlKey, true);
      }
      return;
    }
    if (fromSearch && !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    const index = rows.findIndex((row) => row.node.path === focused),
      row = rows[index];
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const position = getSidebarContextPosition(event);
      if (position) setMenu({ ...position, path: row?.node.path ?? null });
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        reveal(nextFileTreeIndex(rows, index, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        reveal(nextFileTreeIndex(rows, index, -1));
        break;
      case 'Home':
        event.preventDefault();
        reveal(0);
        break;
      case 'End':
        event.preventDefault();
        reveal(rows.length - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (!row) break;
        if (row.node.type === 'file') open(row.node.path, event.metaKey || event.ctrlKey);
        else if (!row.isExpanded) toggle(row.node.path);
        else if (row.node.children.length) reveal(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (!row) break;
        if (row.node.type === 'directory' && row.isExpanded) toggle(row.node.path);
        else reveal(parentFileTreeIndex(rows, index));
        break;
      case 'Enter':
        event.preventDefault();
        if (!row) break;
        if (fromSearch || ((event.metaKey || event.ctrlKey) && row.node.type === 'file')) {
          if (row.node.type === 'file') open(row.node.path, event.metaKey || event.ctrlKey);
          else toggle(row.node.path);
        } else unavailable(m.fileExplorer_tree_rename_label());
        break;
      case ' ':
        event.preventDefault();
        if (!row) break;
        if (row.node.type === 'file') open(row.node.path, event.metaKey || event.ctrlKey);
        else toggle(row.node.path);
        break;
      default:
        if (
          !fromSearch &&
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          clearTimeout(typeahead.current.timer);
          typeahead.current.text += event.key.toLowerCase();
          typeahead.current.timer = setTimeout(() => {
            typeahead.current.text = '';
          }, 500);
          for (const prefix of [typeahead.current.text, event.key.toLowerCase()]) {
            let found = false;
            for (let offset = 1; offset <= rows.length; offset++) {
              const next = (index + offset) % rows.length;
              if (rows[next].node.name.toLowerCase().startsWith(prefix)) {
                reveal(next);
                typeahead.current.text = prefix;
                found = true;
                break;
              }
            }
            if (found) break;
          }
        }
    }
  }
  const menuRow = rows.find((row) => row.node.path === menu?.path);
  const menuItems: SidebarMenuEntry[] = [
    ...(menuRow
      ? [
          {
            id: 'open',
            label:
              menuRow.node.type === 'file'
                ? m.fileExplorer_tree_open_label()
                : menuRow.isExpanded
                  ? m.fileExplorer_tree_collapse_label()
                  : m.fileExplorer_tree_expand_label(),
            icon: ArrowSquareOutIcon,
            onClick: () => {
              if (menuRow.node.type === 'file') open(menuRow.node.path);
              else toggle(menuRow.node.path);
              setMenu(null);
            },
          },
        ]
      : []),
    {
      id: 'new',
      label: m.fileExplorer_tree_newFile_label(),
      icon: PlusIcon,
      onClick: () => {
        unavailable(m.fileExplorer_tree_newFile_label());
        setMenu(null);
      },
    },
    ...(menuRow
      ? [
          {
            id: 'rename',
            label: m.fileExplorer_tree_rename_label(),
            icon: PencilSimpleIcon,
            onClick: () => {
              unavailable(m.fileExplorer_tree_rename_label());
              setMenu(null);
            },
          },
        ]
      : []),
    ...(menuRow?.node.type === 'file'
      ? [
          { type: 'separator' as const },
          {
            id: 'delete',
            label: m.fileExplorer_tree_delete_label(),
            icon: TrashIcon,
            destructive: true,
            onClick: () => {
              unavailable(m.fileExplorer_tree_delete_label());
              setMenu(null);
            },
          },
        ]
      : []),
    ...(menuRow
      ? [
          { type: 'separator' as const },
          {
            id: 'download',
            label:
              menuRow.node.type === 'file'
                ? m.fileExplorer_tree_download_label()
                : m.fileExplorer_tree_downloadZip_label(),
            icon: DownloadSimpleIcon,
            onClick: () => {
              unavailable(
                menuRow.node.type === 'file'
                  ? m.fileExplorer_tree_download_label()
                  : m.fileExplorer_tree_downloadZip_label(),
              );
              setMenu(null);
            },
          },
          {
            id: 'reveal',
            label: m.layout_panelTabBar_revealIn_label({
              fileManager: m.layout_panelTabBar_fileManagerGeneric_label(),
            }),
            onClick: () => {
              unavailable(
                m.layout_panelTabBar_revealIn_label({
                  fileManager: m.layout_panelTabBar_fileManagerGeneric_label(),
                }),
              );
              setMenu(null);
            },
          },
        ]
      : []),
  ];
  const start = Math.max(0, Math.floor(scrollTop / 25) - 5),
    end = Math.min(rows.length, Math.ceil((scrollTop + height) / 25) + 5);
  const expanded = state.expandedPaths.some((path) => path !== root);
  return (
    <section
      className="desktop-context-card desktop-files-card"
      hidden={!visible}
      data-desktop-files
    >
      <div className="desktop-context-heading">
        <h2 className="text-ui font-semibold flex-1">
          {m.workspace_multiSelectSidebar_filesTab_label()}
        </h2>
        <SidebarHeaderAction
          icon="close"
          label={m.ui_tab_close_ariaLabel()}
          onClick={() => {
            if (current()) onClose();
          }}
        />
      </div>
      <p className="desktop-files-description">
        {workspace?.skipWorktree
          ? m.workspace_multiSelectSidebar_workingDirectlyIn_before()
          : m.workspace_multiSelectSidebar_repoCopyLivesIn_before()}{' '}
        <Button
          variant="plain"
          wrapContent={false}
          className="desktop-files-directory"
          onClick={() => unavailable(m.fileExplorer_tree_open_label())}
        >
          <span className="underline decoration-muted-foreground/20 underline-offset-2 hover:decoration-current">{`/${root.split('/').slice(-2).join('/')}.`}</span>
        </Button>
      </p>
      <div className="desktop-files-content">
        <div className="desktop-files-toolbar" data-file-tree-toolbar>
          <ExpandableFileSearch
            query={query}
            onQueryChange={(value) => {
              if (current()) {
                setQuery(value);
                setSearchIndex(0);
                lastReveal.current = '';
              }
            }}
            onKeydown={(event) => onKey(event, true)}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-subtle shrink-0"
            aria-label={m.workspace_multiSelectSidebar_newFile_tooltip()}
            onClick={() => unavailable(m.workspace_multiSelectSidebar_newFile_tooltip())}
          >
            <PlusIcon size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={`shrink-0 ${changedOnly ? 'text-primary-ink' : 'text-subtle'}`}
            aria-label={
              changedOnly
                ? m.workspace_multiSelectSidebar_showAllFiles_tooltip()
                : m.workspace_multiSelectSidebar_showOnlyChangedFiles_tooltip()
            }
            onClick={() => {
              if (current()) {
                setSearchIndex(0);
                setChangedOnly(!changedOnly);
              }
            }}
          >
            <PencilSimpleIcon size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-subtle shrink-0"
            aria-label={
              expanded
                ? m.workspace_multiSelectSidebar_collapseAll_tooltip()
                : m.workspace_multiSelectSidebar_expandAll_tooltip()
            }
            onClick={() => {
              if (current())
                store.dispatch(
                  expanded
                    ? clearExpandedPathsExceptRoot(workspaceId)
                    : expandAllRequested(workspaceId),
                );
            }}
          >
            {expanded ? <ArrowsInIcon size={12} /> : <ArrowsOutIcon size={12} />}
          </Button>
        </div>
        {state.error || search?.error ? (
          <ErrorState
            density="compact"
            message={state.error ?? search?.error ?? ''}
            retryLabel={m.fileExplorer_treeView_retry_label()}
            onRetry={() => {
              if (current()) {
                if (searchQuery)
                  store.dispatch(
                    fileSearchRequested(
                      workspaceId,
                      consumer,
                      crypto.randomUUID(),
                      searchQuery,
                      context ?? undefined,
                    ),
                  );
                else
                  store.dispatch(
                    initializeFileExplorer(workspaceId, { workspacePath: root, workspaceId }),
                  );
              }
            }}
          />
        ) : !state.isInitialized || state.isLoading || (searchQuery && !search?.settled) ? (
          <LoadingState density="compact" count={6} label={m.chat_chatMessage_loading_label()} />
        ) : searchQuery ? (
          <div ref={searchResults} className="desktop-files-search-results">
            {search?.truncated && (
              <p className="type-caption text-muted-foreground">
                {m.workspace_fileFinder_limited_description()}
              </p>
            )}
            <ListContainer spacing="compact">
              {results.map((path, index) => (
                <ListItem
                  key={path}
                  data-file-path={path}
                  data-search-selected={searchIndex === index}
                  title={path.split('/').at(-1)}
                  titleClass="type-body font-normal"
                  subtitle={workspaceRelativeFilePath(path, root) ?? path}
                  selected={searchIndex === index}
                  active={selected === path || selected === `${root}/${path}`}
                  size="sm"
                  iconSnippet={<FileGlyph name={path} />}
                  onClick={(event) => open(path, event.metaKey || event.ctrlKey, true)}
                />
              ))}
            </ListContainer>
            {results.length === 0 && (
              <p className="text-xs text-subtle py-4 text-center">
                {m.fileExplorer_treeView_noFiles_label()}
              </p>
            )}
          </div>
        ) : (
          <div
            ref={tree}
            className="desktop-files-tree"
            role="tree"
            tabIndex={0}
            aria-label={m.fileExplorer_tree_fileExplorer_ariaLabel()}
            onKeyDown={(event) => onKey(event)}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onContextMenu={(event) => {
              const position = getSidebarContextPosition(event);
              if (current() && position) setMenu({ ...position, path: null });
            }}
          >
            <div style={{ height: rows.length * 25, position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${start * 25}px)`,
                }}
              >
                {rows.slice(start, end).map((row) => (
                  <div
                    className="desktop-file-tree-row group/file-row isolate"
                    data-file-path={row.node.path}
                    key={row.node.path}
                    onDoubleClick={() => unavailable(m.fileExplorer_tree_rename_label())}
                    onContextMenu={(event) => {
                      const position = getSidebarContextPosition(event);
                      if (current() && position) setMenu({ ...position, path: row.node.path });
                    }}
                  >
                    <ListItem
                      size="sm"
                      title={row.displayPath ?? row.node.name}
                      titleClass={`type-body font-normal leading-(--text-body-line-height) ${row.directoryHasChanges ? 'text-warning-ink' : gitStatusColor(row.gitStatus?.status)}`}
                      indent={row.depth}
                      indentSize={16}
                      className="bg-transparent!"
                      active={selected === row.node.path}
                      selected={focused === row.node.path}
                      tabIndex={-1}
                      aria-expanded={row.node.type === 'directory' ? row.isExpanded : undefined}
                      iconClass={
                        row.node.type === 'directory'
                          ? '-ml-1 mr-1 w-3 text-muted-foreground'
                          : undefined
                      }
                      iconSnippet={
                        row.node.type === 'directory' ? (
                          row.isExpanded ? (
                            <CaretDownIcon size={12} />
                          ) : (
                            <CaretRightIcon size={12} />
                          )
                        ) : (
                          <FileGlyph name={row.node.name} />
                        )
                      }
                      onClick={(event) => {
                        if (!current()) return;
                        setFocused(row.node.path);
                        tree.current?.focus();
                        if (row.node.type === 'directory') toggle(row.node.path);
                        else open(row.node.path, event.metaKey || event.ctrlKey);
                      }}
                      actions={
                        row.node.type === 'directory'
                          ? [
                              {
                                icon: PlusIcon,
                                label: m.fileExplorer_tree_newFile_label(),
                                tooltip: m.workspace_multiSelectSidebar_newFile_tooltip(),
                                onClick: (event) => {
                                  event.stopPropagation();
                                  unavailable(m.fileExplorer_tree_newFile_label());
                                },
                              },
                            ]
                          : []
                      }
                    />
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute -z-10 inset-x-1 inset-y-0.5 rounded-(--radius-small) border border-transparent transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none ${selected === row.node.path ? 'bg-active' : focused === row.node.path ? 'bg-selected' : 'bg-transparent group-hover/file-row:bg-hover'}`}
                    />
                    {state.directoryErrors[row.node.path] && (
                      <Button variant="outline" size="xs" onClick={() => toggle(row.node.path)}>
                        {m.fileExplorer_treeView_retry_label()}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {menu && active && visible && (
        <SidebarContextMenu {...menu} items={menuItems} onClickOutside={() => setMenu(null)} />
      )}
    </section>
  );
}

function FileGlyph({ name }: { name: string }) {
  // Bundled material-file-icons SVG, selected by filename; never file or provider markup.
  return (
    <span
      className="desktop-file-glyph"
      dangerouslySetInnerHTML={{ __html: getFileTypeIconSvg(name) }}
    />
  );
}

// Source porcelain precedence, using the established semantic palette.
function gitStatusColor(status?: string) {
  if (!status) return '';
  if (status === '??') return 'text-muted-foreground';
  if (status.includes('A')) return 'text-success';
  if (status.includes('M')) return 'text-warning-ink';
  if (status.includes('D')) return 'text-danger';
  if (status.includes('R') || status.includes('C')) return 'text-info';
  return 'text-warning-ink';
}
