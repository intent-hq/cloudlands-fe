// Source: src/features/onboarding/messages/DirectoryPickerView.svelte.
// This view owns only transient interaction state; the caller owns directory requests.
import { Fragment, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowUpIcon,
  DesktopIcon,
  DownloadSimpleIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HardDriveIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PenIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { menuItem } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/screen';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import type {
  DirectoryPickerEntry,
  DirectoryPickerListing,
} from '../../../../../../src/store/renderer/slices/directory-picker/directory-picker-slice';
import {
  buildDirectoryPickerBreadcrumbs,
  collapseDirectoryPickerPath,
  directoryPickerFavorites,
  filterDirectoryPickerEntries,
  findActiveFavoriteId,
  type DirectoryPickerFavorite as SourceDirectoryPickerFavorite,
} from '../../../../../../src/features/onboarding/messages/directory-picker-view';
import './directory-picker-view.css';

export type DirectoryPickerFavorite = Omit<SourceDirectoryPickerFavorite, 'icon'> & {
  icon?: Icon;
};

export interface DirectoryPickerViewProps {
  open: boolean;
  embedded?: boolean;
  title?: string;
  selectLabel?: string;
  listing: DirectoryPickerListing | null;
  loading: boolean;
  error: string | null;
  pathError: string | null;
  createError?: string | null;
  mode?: 'directory' | 'file';
  showFiles?: boolean;
  favorites?: DirectoryPickerFavorite[];
  initialSearchQuery?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
  onNavigate: (path?: string) => void;
  onNavigateToPath: (path: string) => void;
  onClearPathError: () => void;
  onCreateDirectory?: (path: string) => void;
  onClearCreateError?: () => void;
}

const pickerRowClass =
  'flex h-8 w-full cursor-pointer items-center justify-start gap-2 rounded-md px-2 py-1 text-left hover:bg-hover';

function favoriteIcon(favorite: DirectoryPickerFavorite): Icon {
  if (favorite.icon) return favorite.icon;
  if (favorite.id === 'home') return HouseIcon;
  if (favorite.id === 'desktop') return DesktopIcon;
  if (favorite.id === 'downloads') return DownloadSimpleIcon;
  if (favorite.id === 'computer') return HardDriveIcon;
  return FolderIcon;
}

export function DirectoryPickerView({
  open,
  embedded = false,
  title = m.onboarding_dirPicker_selectFolder_label(),
  selectLabel = m.onboarding_dirPicker_selectFolder_label(),
  listing,
  loading,
  error,
  pathError,
  createError = null,
  mode = 'directory',
  showFiles = false,
  favorites,
  initialSearchQuery = '',
  onClose,
  onSelect,
  onNavigate,
  onNavigateToPath,
  onClearPathError,
  onCreateDirectory,
  onClearCreateError,
}: DirectoryPickerViewProps) {
  const uid = useId();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [pathDraft, setPathDraft] = useState('');
  const [pathEditing, setPathEditing] = useState(false);
  const [sidebarHighlight, setSidebarHighlight] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [lastListingPath, setLastListingPath] = useState<string | null>(null);
  const [lastDisplayPath, setLastDisplayPath] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  // Cancellation blurs synchronously, before React has committed the state update.
  const cancellingPathEdit = useRef(false);

  const defaultFavorites: DirectoryPickerFavorite[] =
    favorites ??
    directoryPickerFavorites(listing, {
      home: m.onboarding_dirPicker_home_label(),
      desktop: m.onboarding_dirPicker_desktop_label(),
      documents: m.onboarding_dirPicker_documents_label(),
      downloads: m.onboarding_dirPicker_downloads_label(),
      computer: m.onboarding_dirPicker_computer_label(),
    }).map(({ id, label, path }) => ({ id, label, path }));
  const breadcrumbs = listing ? buildDirectoryPickerBreadcrumbs(listing.path, listing.home) : [];
  const visibleEntries = useMemo(
    () =>
      filterDirectoryPickerEntries(
        listing?.entries ?? [],
        searchDraft,
        showFiles || mode === 'file',
      ),
    [listing, searchDraft, showFiles, mode],
  );
  const canSelect = mode === 'file' ? selectedFilePath !== null : listing !== null;
  const activeFavoriteId =
    sidebarHighlight ??
    findActiveFavoriteId(
      listing?.path,
      defaultFavorites.map(({ id, label, path }) => ({ id, label, path })),
    );
  const displayPath = listing ? collapseDirectoryPickerPath(listing.path, listing.home) : '';
  const selectedFolderEntry =
    mode === 'directory' && selectedFolderPath !== null
      ? (visibleEntries.find((entry) => entry.isDirectory && entry.path === selectedFolderPath) ??
        null)
      : null;
  const selectTargetName =
    mode === 'directory' ? (selectedFolderEntry?.name ?? breadcrumbs.at(-1)?.label ?? null) : null;
  const selectButtonLabel =
    selectTargetName !== null
      ? m.onboarding_dirPicker_selectNamed_label({ name: selectTargetName })
      : selectLabel;
  const listboxId = `${uid}-contents`;
  const activeOptionId = visibleEntries.length > 0 ? `${uid}-entry-${focusedIndex}` : undefined;
  const [previousEntries, setPreviousEntries] = useState(visibleEntries);

  // Reconcile source-derived UI resets before committing children with stale selection.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSearchDraft(initialSearchQuery);
  }
  const listingPath = listing?.path ?? null;
  if (listingPath !== lastListingPath || displayPath !== lastDisplayPath) {
    const changed = listingPath !== lastListingPath;
    setLastListingPath(listingPath);
    setLastDisplayPath(displayPath);
    if (changed) {
      setPathEditing(false);
      setSidebarHighlight(null);
      setSelectedFilePath(null);
      setSelectedFolderPath(null);
      setNewFolderOpen(false);
      setNewFolderName('');
    }
    if (changed || !pathEditing) setPathDraft(displayPath);
  }
  if (previousEntries !== visibleEntries) {
    setPreviousEntries(visibleEntries);
    setFocusedIndex(0);
    setSelectedFolderPath(null);
  }

  function requestNavigation(path?: string) {
    setFocusedIndex(0);
    setSelectedFilePath(null);
    setSelectedFolderPath(null);
    onNavigate(path);
    queueMicrotask(() => listContainerRef.current?.scrollTo({ top: 0 }));
  }

  function navigateInto(entry: DirectoryPickerEntry) {
    if (entry.isDirectory) requestNavigation(entry.path);
  }

  function activateEntry(entry: DirectoryPickerEntry) {
    if (entry.isDirectory) navigateInto(entry);
    else if (mode === 'file') setSelectedFilePath(entry.path);
  }

  function navigateUp() {
    if (listing?.parent) requestNavigation(listing.parent);
  }

  function handleFavoriteClick(favorite: DirectoryPickerFavorite) {
    setSidebarHighlight(favorite.id);
    requestNavigation(favorite.path);
  }

  function expandTypedPath(raw: string): string {
    const trimmed = raw.trim();
    if (!listing?.home) return trimmed;
    if (trimmed === '~') return listing.home;
    return trimmed.startsWith('~/') ? listing.home + trimmed.slice(1) : trimmed;
  }

  function beginPathEdit() {
    setPathEditing(true);
    setPathDraft(displayPath);
    queueMicrotask(() => {
      pathInputRef.current?.focus();
      pathInputRef.current?.select();
    });
  }

  function cancelPathEdit() {
    setPathEditing(false);
    setPathDraft(displayPath);
    if (pathError) onClearPathError();
    cancellingPathEdit.current = true;
    pathInputRef.current?.blur();
    cancellingPathEdit.current = false;
  }

  function commitPathInput() {
    if (!pathEditing || cancellingPathEdit.current) return;
    const target = expandTypedPath(pathDraft);
    if (!target) {
      cancelPathEdit();
    } else if (target === listing?.path) {
      setPathEditing(false);
      setPathDraft(displayPath);
      if (pathError) onClearPathError();
    } else {
      setSelectedFilePath(null);
      setSelectedFolderPath(null);
      onNavigateToPath(target);
    }
  }

  function handlePathInputKeydown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPathInput();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelPathEdit();
    }
  }

  function openNewFolder() {
    setNewFolderOpen(true);
    queueMicrotask(() => newFolderInputRef.current?.focus());
  }

  function cancelNewFolder() {
    setNewFolderOpen(false);
    setNewFolderName('');
    if (createError) onClearCreateError?.();
  }

  function commitNewFolder() {
    if (!listing || loading || !onCreateDirectory) return;
    const name = newFolderName.trim();
    if (!name) return;
    const base = listing.path.endsWith('/') ? listing.path : `${listing.path}/`;
    onCreateDirectory(`${base}${name}`);
  }

  function handleNewFolderKeydown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNewFolder();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelNewFolder();
    }
  }

  function handleSelect() {
    const path = mode === 'file' ? selectedFilePath : (selectedFolderEntry?.path ?? listing?.path);
    if (path) onSelect(path);
  }

  function retryListing() {
    requestNavigation(listing?.path);
  }

  function retryPathNavigation() {
    onClearPathError();
    if (pathEditing) queueMicrotask(() => pathInputRef.current?.focus());
    else beginPathEdit();
  }

  const handleKeydown = useEffectEvent((event: KeyboardEvent) => {
    if (
      !open ||
      event.defaultPrevented ||
      event.target === pathInputRef.current ||
      event.target === newFolderInputRef.current
    )
      return;
    if (event.target === searchInputRef.current) {
      if (event.key === 'Escape') setSearchDraft('');
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex(Math.min(focusedIndex + 1, Math.max(visibleEntries.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex(Math.max(focusedIndex - 1, 0));
    } else if (event.key === 'Enter') {
      const entry = visibleEntries[focusedIndex];
      if (entry) {
        event.preventDefault();
        activateEntry(entry);
      }
    } else if (event.key === 'Backspace' && listing?.parent) {
      event.preventDefault();
      navigateUp();
    }
  });

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => handleKeydown(event);
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  useEffect(() => {
    if (open) queueMicrotask(() => dialogRef.current?.focus());
  }, [open]);

  useEffect(() => {
    queueMicrotask(() =>
      listContainerRef.current
        ?.querySelector<HTMLElement>(`[data-picker-index="${focusedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  }, [focusedIndex, visibleEntries]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role={embedded ? 'group' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={title}
      className="directory-picker flex h-[min(32rem,calc(100dvh-2rem))] min-w-0 w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl focus:outline-none"
    >
      <header className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpenIcon aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-medium">{title}</h2>
        </div>
        <Button
          type="button"
          variant="ghost-light"
          size="icon-compact"
          iconOnly
          onClick={onClose}
          aria-label={m.onboarding_dirPicker_close_ariaLabel()}
          tooltip={m.onboarding_dirPicker_close_ariaLabel()}
        >
          <XIcon aria-hidden="true" size="0.875em" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="picker-sidebar w-44 shrink-0 overflow-y-auto border-r border-border bg-muted/15 px-3 py-3">
          <h3 className="mb-1 px-2 text-xs font-semibold text-muted-foreground">
            {m.onboarding_dirPicker_favorites_label()}
          </h3>
          <nav className="space-y-0.5" aria-label={m.onboarding_dirPicker_favorites_label()}>
            {defaultFavorites.map((favorite) => {
              const FavoriteIcon = favoriteIcon(favorite);
              return (
                <Button
                  key={favorite.id}
                  type="button"
                  variant="ghost-light"
                  size="sm"
                  className={cn(
                    menuItem(),
                    pickerRowClass,
                    activeFavoriteId === favorite.id && 'bg-selected text-foreground',
                  )}
                  aria-current={activeFavoriteId === favorite.id ? 'location' : undefined}
                  title={favorite.path}
                  onClick={() => handleFavoriteClick(favorite)}
                >
                  <FavoriteIcon
                    aria-hidden="true"
                    className="w-3.5 shrink-0 text-blue-500/80"
                    size="0.875em"
                  />
                  <span className="truncate">{favorite.label}</span>
                </Button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/10 px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-compact"
              iconOnly
              disabled={!listing?.parent || loading}
              onClick={navigateUp}
              aria-label={m.onboarding_dirPicker_goUp_ariaLabel()}
              tooltip={m.onboarding_dirPicker_goUp_tooltip()}
            >
              <ArrowUpIcon aria-hidden="true" size="0.875em" />
            </Button>

            {pathEditing ? (
              <Input
                ref={pathInputRef}
                value={pathDraft}
                type="text"
                className={cn(
                  'min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs font-mono text-foreground outline-none',
                  pathError ? 'border-danger/60' : 'border-border focus-visible:border-ring',
                )}
                aria-label={m.onboarding_dirPicker_path_ariaLabel()}
                aria-invalid={pathError ? true : undefined}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setPathDraft(event.currentTarget.value);
                  if (pathError) onClearPathError();
                }}
                onKeyDown={handlePathInputKeydown}
                onBlur={commitPathInput}
              />
            ) : (
              <>
                <nav
                  className="flex min-w-0 flex-1 items-center overflow-hidden text-xs"
                  aria-label={m.onboarding_dirPicker_breadcrumbs_ariaLabel()}
                >
                  {breadcrumbs.map((breadcrumb, index) => (
                    <Fragment key={breadcrumb.path}>
                      {index > 0 && <span className="px-0.5 text-ghost">/</span>}
                      <Button
                        type="button"
                        variant="ghost-light"
                        size="compact"
                        className="min-w-0 truncate px-1"
                        title={breadcrumb.path}
                        onClick={() => requestNavigation(breadcrumb.path)}
                      >
                        {breadcrumb.label}
                      </Button>
                    </Fragment>
                  ))}
                </nav>
                <Button
                  type="button"
                  variant="ghost-light"
                  size="icon-compact"
                  iconOnly
                  onClick={beginPathEdit}
                  aria-label={m.onboarding_dirPicker_editPath_ariaLabel()}
                  tooltip={m.onboarding_dirPicker_editPath_ariaLabel()}
                >
                  <PenIcon aria-hidden="true" size="0.75em" />
                </Button>
              </>
            )}

            <label htmlFor={`${uid}-search`} className="relative block w-28 shrink-0 sm:w-40">
              <MagnifyingGlassIcon
                aria-hidden="true"
                size="0.75em"
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id={`${uid}-search`}
                ref={searchInputRef}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.currentTarget.value)}
                type="search"
                className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring"
                placeholder={m.onboarding_dirPicker_search_placeholder()}
                aria-label={m.onboarding_dirPicker_search_ariaLabel()}
                autoComplete="off"
              />
            </label>
          </div>

          <div
            id={listboxId}
            ref={listContainerRef}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The source listbox contains rich directory rows and loading/error controls, which a native select cannot host.
            role="listbox"
            aria-label={m.onboarding_dirPicker_contents_ariaLabel()}
            aria-activedescendant={activeOptionId}
          >
            {loading ? (
              <LoadingState
                recipe="list"
                count={6}
                rowHeight={32}
                label={m.onboarding_dirPicker_loading_label()}
                className="gap-2 py-1"
              />
            ) : pathError ? (
              <ErrorState
                message={pathError}
                retryLabel={m.ui_errorToast_retry_label()}
                onRetry={retryPathNavigation}
                className="h-full min-h-full"
              />
            ) : error ? (
              <ErrorState
                message={
                  <>
                    <span>{m.onboarding_dirPicker_readError_title()}</span>
                    <span className="mt-1 block type-caption wrap-anywhere">{error}</span>
                  </>
                }
                retryLabel={m.ui_errorToast_retry_label()}
                onRetry={retryListing}
                className="h-full min-h-full"
              />
            ) : visibleEntries.length === 0 ? (
              <EmptyState
                description={
                  searchDraft.trim()
                    ? m.onboarding_dirPicker_noSearchResults_description()
                    : showFiles
                      ? m.onboarding_dirPicker_emptyFolder_description()
                      : m.onboarding_dirPicker_noSubfolders_description({
                          label: selectButtonLabel,
                        })
                }
                className="h-full min-h-full"
                data-state-kind="empty"
              />
            ) : (
              <ul role="presentation" className="space-y-0.5">
                {visibleEntries.map((entry, index) => {
                  const isFocused = index === focusedIndex;
                  const isSelected =
                    mode === 'file'
                      ? entry.path === selectedFilePath
                      : entry.path === selectedFolderEntry?.path;
                  const EntryIcon = entry.isDirectory ? FolderIcon : FileIcon;
                  return (
                    <li key={entry.path} role="presentation">
                      <Button
                        id={`${uid}-entry-${index}`}
                        type="button"
                        variant="ghost"
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Directory options retain the source button's click and double-click navigation contract.
                        role="option"
                        tabIndex={-1}
                        aria-selected={
                          mode === 'file'
                            ? isSelected
                            : selectedFolderEntry
                              ? isSelected
                              : isFocused
                        }
                        aria-disabled={!entry.isDirectory && mode !== 'file'}
                        data-picker-index={index}
                        className={cn(
                          menuItem(),
                          pickerRowClass,
                          entry.isDirectory || mode === 'file'
                            ? undefined
                            : 'cursor-not-allowed text-ghost',
                          isSelected || (mode === 'directory' && !selectedFolderEntry && isFocused)
                            ? 'bg-selected'
                            : isFocused
                              ? 'bg-active'
                              : undefined,
                        )}
                        onClick={() => {
                          setFocusedIndex(index);
                          if (!entry.isDirectory && mode === 'file')
                            setSelectedFilePath(entry.path);
                          else if (entry.isDirectory && mode === 'directory')
                            setSelectedFolderPath(entry.path);
                        }}
                        onDoubleClick={() => navigateInto(entry)}
                      >
                        <EntryIcon
                          aria-hidden="true"
                          className={
                            entry.isGitRepo
                              ? 'text-warning-ink'
                              : entry.isDirectory
                                ? 'text-blue-500/80'
                                : 'text-ghost'
                          }
                          size="0.875em"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                        {entry.isGitRepo && (
                          <span title={m.onboarding_dirPicker_gitRepository_tooltip()}>
                            <GitBranchIcon
                              aria-hidden="true"
                              className="text-warning-ink"
                              size="0.75em"
                            />
                          </span>
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {createError && (
        <div
          className="shrink-0 border-t border-border bg-danger-background/10 px-3 py-1.5 text-xs text-danger/90"
          role="alert"
        >
          {createError}
        </div>
      )}

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/10 px-4 py-3">
        {mode === 'directory' &&
          onCreateDirectory &&
          (newFolderOpen ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.currentTarget.value)}
                type="text"
                className={cn(
                  'min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm text-foreground outline-none',
                  createError ? 'border-danger/60' : 'border-border focus-visible:border-ring',
                )}
                placeholder={m.onboarding_dirPicker_newFolderName_placeholder()}
                aria-label={m.onboarding_dirPicker_newFolderName_ariaLabel()}
                aria-invalid={createError ? true : undefined}
                spellCheck={false}
                autoComplete="off"
                onKeyDown={handleNewFolderKeydown}
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!listing || loading}
              onClick={openNewFolder}
            >
              {m.onboarding_dirPicker_newFolder_label()}
            </Button>
          ))}
        <Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={onClose}>
          {m.onboarding_dirPicker_cancel_label()}
        </Button>
        <Button
          type="button"
          variant={canSelect && !loading ? 'primary' : 'ghost'}
          size="sm"
          className="max-w-56"
          disabled={!canSelect || loading}
          onClick={handleSelect}
        >
          {selectButtonLabel}
        </Button>
      </footer>
    </div>
  );
}

export default DirectoryPickerView;
