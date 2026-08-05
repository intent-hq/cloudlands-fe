<script lang="ts">
  import { untrack } from 'svelte';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import {
    faArrowUp,
    faCodeBranch,
    faDesktop,
    faDownload,
    faFile,
    faFolder,
    faFolderOpen,
    faHardDrive,
    faHouse,
    faMagnifyingGlass,
    faPen,
    faSpinner,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    DirectoryPickerEntry,
    DirectoryPickerListing,
  } from '$store/renderer/slices/directory-picker/directory-picker-slice';

  import {
    buildDirectoryPickerBreadcrumbs,
    collapseDirectoryPickerPath,
    favoritesFromHome,
    filterDirectoryPickerEntries,
    findActiveFavoriteId,
    type DirectoryPickerFavorite,
  } from './directory-picker-view';

  interface Props {
    open: boolean;
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

  let {
    open,
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
  }: Props = $props();

  let focusedIndex = $state(0);
  let searchDraft = $state('');
  let pathDraft = $state('');
  let pathEditing = $state(false);
  let sidebarHighlight = $state<string | null>(null);
  let dialogRef = $state<HTMLElement | null>(null);
  let listContainerRef = $state<HTMLDivElement | null>(null);
  let pathInputRef = $state<HTMLInputElement | null>(null);
  let searchInputRef = $state<HTMLInputElement | null>(null);
  let newFolderInputRef = $state<HTMLInputElement | null>(null);
  let newFolderOpen = $state(false);
  let newFolderName = $state('');
  let selectedFilePath = $state<string | null>(null);
  let lastListingPath: string | null = null;
  let wasOpen = false;

  const defaultFavorites = $derived(
    favorites ??
      favoritesFromHome(listing?.home, {
        home: m.onboarding_dirPicker_home_label(),
        desktop: m.onboarding_dirPicker_desktop_label(),
        documents: m.onboarding_dirPicker_documents_label(),
        downloads: m.onboarding_dirPicker_downloads_label(),
        computer: m.onboarding_dirPicker_computer_label(),
      }),
  );
  const breadcrumbs = $derived(
    listing ? buildDirectoryPickerBreadcrumbs(listing.path, listing.home) : [],
  );
  const visibleEntries = $derived(
    filterDirectoryPickerEntries(listing?.entries ?? [], searchDraft, showFiles || mode === 'file'),
  );
  const canSelect = $derived(mode === 'file' ? selectedFilePath !== null : listing !== null);
  const activeFavoriteId = $derived(
    sidebarHighlight ?? findActiveFavoriteId(listing?.path, defaultFavorites),
  );
  const displayPath = $derived(
    listing ? collapseDirectoryPickerPath(listing.path, listing.home) : '',
  );

  function favoriteIcon(favorite: DirectoryPickerFavorite): IconDefinition {
    if (favorite.icon) return favorite.icon;
    if (favorite.id === 'home') return faHouse;
    if (favorite.id === 'desktop') return faDesktop;
    if (favorite.id === 'downloads') return faDownload;
    if (favorite.id === 'computer') return faHardDrive;
    return faFolder;
  }

  function requestNavigation(path?: string) {
    focusedIndex = 0;
    selectedFilePath = null;
    onNavigate(path);
    queueMicrotask(() => listContainerRef?.scrollTo({ top: 0 }));
  }

  function navigateInto(entry: DirectoryPickerEntry) {
    if (entry.isDirectory) requestNavigation(entry.path);
  }

  function activateEntry(entry: DirectoryPickerEntry) {
    if (entry.isDirectory) navigateInto(entry);
    else if (mode === 'file') selectedFilePath = entry.path;
  }

  function navigateUp() {
    if (listing?.parent) requestNavigation(listing.parent);
  }

  function handleFavoriteClick(favorite: DirectoryPickerFavorite) {
    sidebarHighlight = favorite.id;
    requestNavigation(favorite.path);
  }

  function expandTypedPath(raw: string): string {
    const trimmed = raw.trim();
    if (!listing?.home) return trimmed;
    if (trimmed === '~') return listing.home;
    return trimmed.startsWith('~/') ? listing.home + trimmed.slice(1) : trimmed;
  }

  function beginPathEdit() {
    pathEditing = true;
    pathDraft = displayPath;
    queueMicrotask(() => {
      pathInputRef?.focus();
      pathInputRef?.select();
    });
  }

  function cancelPathEdit() {
    pathEditing = false;
    pathDraft = displayPath;
    if (pathError) onClearPathError();
    pathInputRef?.blur();
  }

  function commitPathInput() {
    if (!pathEditing) return;
    const target = expandTypedPath(pathDraft);
    if (!target) {
      cancelPathEdit();
    } else if (target === listing?.path) {
      pathEditing = false;
      pathDraft = displayPath;
      if (pathError) onClearPathError();
    } else {
      onNavigateToPath(target);
    }
  }

  function handlePathInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPathInput();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelPathEdit();
    }
  }

  function openNewFolder() {
    newFolderOpen = true;
    queueMicrotask(() => newFolderInputRef?.focus());
  }

  function cancelNewFolder() {
    newFolderOpen = false;
    newFolderName = '';
    if (createError) onClearCreateError?.();
  }

  function commitNewFolder() {
    if (!listing || loading || !onCreateDirectory) return;
    const name = newFolderName.trim();
    if (!name) return;
    const base = listing.path.endsWith('/') ? listing.path : `${listing.path}/`;
    onCreateDirectory(`${base}${name}`);
  }

  function handleNewFolderKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNewFolder();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelNewFolder();
    }
  }

  function handleSelect() {
    const path = mode === 'file' ? selectedFilePath : listing?.path;
    if (path) onSelect(path);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      !open ||
      event.defaultPrevented ||
      event.target === pathInputRef ||
      event.target === newFolderInputRef
    )
      return;
    if (event.target === searchInputRef) {
      if (event.key === 'Escape') searchDraft = '';
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, Math.max(visibleEntries.length - 1, 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
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
  }

  $effect(() => {
    if (open && !wasOpen) {
      searchDraft = initialSearchQuery;
      queueMicrotask(() => dialogRef?.focus());
    }
    wasOpen = open;
  });

  $effect(() => {
    const path = listing?.path ?? null;
    const nextDisplayPath = displayPath;
    untrack(() => {
      if (path !== lastListingPath) {
        lastListingPath = path;
        pathEditing = false;
        sidebarHighlight = null;
        selectedFilePath = null;
        newFolderOpen = false;
        newFolderName = '';
      }
      if (!pathEditing) pathDraft = nextDisplayPath;
    });
  });

  $effect(() => {
    void visibleEntries;
    untrack(() => (focusedIndex = 0));
  });

  $effect(() => {
    const index = focusedIndex;
    void visibleEntries;
    queueMicrotask(() =>
      listContainerRef
        ?.querySelector<HTMLElement>(`[data-picker-index="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    bind:this={dialogRef}
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    class="flex h-[32rem] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl focus:outline-none"
  >
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-4">
      <div class="flex min-w-0 items-center gap-2">
        <Fa icon={faFolderOpen} class="shrink-0 text-muted-foreground" />
        <h2 class="truncate text-sm font-medium">{title}</h2>
      </div>
      <button
        type="button"
        class="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onclick={onClose}
        aria-label={m.onboarding_dirPicker_close_ariaLabel()}
      >
        <Fa icon={faXmark} size="sm" />
      </button>
    </header>

    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-44 shrink-0 border-r border-border/30 bg-muted/15 px-2 py-3 sm:block">
        <h3 class="mb-1 px-2 text-xs font-semibold text-muted-foreground">
          {m.onboarding_dirPicker_favorites_label()}
        </h3>
        <nav class="space-y-0.5" aria-label={m.onboarding_dirPicker_favorites_label()}>
          {#each defaultFavorites as favorite (favorite.id)}
            <button
              type="button"
              class={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                activeFavoriteId === favorite.id
                  ? 'bg-muted/70 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
              aria-current={activeFavoriteId === favorite.id ? 'location' : undefined}
              title={favorite.path}
              onclick={() => handleFavoriteClick(favorite)}
            >
              <Fa icon={favoriteIcon(favorite)} class="w-3.5 shrink-0 text-blue-500/80" size="sm" />
              <span class="truncate">{favorite.label}</span>
            </button>
          {/each}
        </nav>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <div
          class="flex min-h-11 shrink-0 items-center gap-2 border-b border-border/30 bg-muted/10 px-3 py-2"
        >
          <button
            type="button"
            class={cn(
              'rounded p-1.5 transition-colors',
              listing?.parent && !loading
                ? 'cursor-pointer text-foreground hover:bg-muted/50'
                : 'cursor-not-allowed text-ghost',
            )}
            disabled={!listing?.parent || loading}
            onclick={navigateUp}
            aria-label={m.onboarding_dirPicker_goUp_ariaLabel()}
            title={m.onboarding_dirPicker_goUp_tooltip()}
          >
            <Fa icon={faArrowUp} size="sm" />
          </button>

          {#if pathEditing}
            <input
              bind:this={pathInputRef}
              bind:value={pathDraft}
              type="text"
              class={cn(
                'min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs font-mono text-foreground outline-none',
                pathError ? 'border-destructive/60' : 'border-border/60 focus:border-border',
              )}
              aria-label={m.onboarding_dirPicker_path_ariaLabel()}
              aria-invalid={pathError ? true : undefined}
              spellcheck="false"
              autocomplete="off"
              oninput={() => pathError && onClearPathError()}
              onkeydown={handlePathInputKeydown}
              onblur={commitPathInput}
            />
          {:else}
            <nav
              class="flex min-w-0 flex-1 items-center overflow-hidden text-xs"
              aria-label={m.onboarding_dirPicker_breadcrumbs_ariaLabel()}
            >
              {#each breadcrumbs as breadcrumb, index (breadcrumb.path)}
                {#if index > 0}<span class="px-0.5 text-ghost">/</span>{/if}
                <button
                  type="button"
                  class="min-w-0 cursor-pointer truncate rounded px-1 py-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  title={breadcrumb.path}
                  onclick={() => requestNavigation(breadcrumb.path)}
                >
                  {breadcrumb.label}
                </button>
              {/each}
            </nav>
            <button
              type="button"
              class="cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onclick={beginPathEdit}
              aria-label={m.onboarding_dirPicker_editPath_ariaLabel()}
              title={m.onboarding_dirPicker_editPath_ariaLabel()}
            >
              <Fa icon={faPen} size="xs" />
            </button>
          {/if}

          <label class="relative block w-28 shrink-0 sm:w-40">
            <Fa
              icon={faMagnifyingGlass}
              size="xs"
              class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              bind:this={searchInputRef}
              bind:value={searchDraft}
              type="search"
              class="w-full rounded-md border border-border/50 bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-border"
              placeholder={m.onboarding_dirPicker_search_placeholder()}
              aria-label={m.onboarding_dirPicker_search_ariaLabel()}
              autocomplete="off"
            />
          </label>
        </div>

        {#if pathError}
          <div
            class="shrink-0 border-b border-border/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground"
            role="alert"
          >
            {pathError}
          </div>
        {/if}

        <div
          bind:this={listContainerRef}
          class="min-h-0 flex-1 overflow-y-auto py-1"
          role="listbox"
          aria-label={m.onboarding_dirPicker_contents_ariaLabel()}
        >
          {#if loading}
            <div class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Fa icon={faSpinner} class="animate-spin" size="sm" />
              <span>{m.onboarding_dirPicker_loading_label()}</span>
            </div>
          {:else if error}
            <div class="px-5 py-10 text-sm text-destructive-foreground">
              <p class="mb-1 font-medium">{m.onboarding_dirPicker_readError_title()}</p>
              <p class="break-all text-xs text-muted-foreground">{error}</p>
            </div>
          {:else if visibleEntries.length === 0}
            <div class="px-4 py-12 text-center text-sm text-muted-foreground">
              {searchDraft.trim()
                ? m.onboarding_dirPicker_noSearchResults_description()
                : showFiles
                  ? m.onboarding_dirPicker_emptyFolder_description()
                  : m.onboarding_dirPicker_noSubfolders_description({ label: selectLabel })}
            </div>
          {:else}
            <ul>
              {#each visibleEntries as entry, index (entry.path)}
                {@const isFocused = index === focusedIndex}
                {@const isSelected = mode === 'file' && entry.path === selectedFilePath}
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={mode === 'file' ? isSelected : isFocused}
                    aria-disabled={!entry.isDirectory && mode !== 'file'}
                    data-picker-index={index}
                    class={cn(
                      'flex h-8 w-full items-center gap-2.5 px-4 text-left transition-colors',
                      entry.isDirectory || mode === 'file'
                        ? 'cursor-default'
                        : 'cursor-not-allowed text-ghost',
                      isSelected
                        ? 'bg-blue-500/20'
                        : isFocused
                          ? 'bg-blue-500/15'
                          : 'hover:bg-muted/30',
                    )}
                    onclick={() => {
                      focusedIndex = index;
                      if (!entry.isDirectory && mode === 'file') selectedFilePath = entry.path;
                    }}
                    ondblclick={() => navigateInto(entry)}
                  >
                    <Fa
                      icon={entry.isDirectory ? faFolder : faFile}
                      class={entry.isGitRepo
                        ? 'text-amber-500'
                        : entry.isDirectory
                          ? 'text-blue-500/80'
                          : 'text-ghost'}
                      size="sm"
                    />
                    <span class="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                    {#if entry.isGitRepo}
                      <span title={m.onboarding_dirPicker_gitRepository_tooltip()}>
                        <Fa icon={faCodeBranch} class="text-amber-500/70" size="xs" />
                      </span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </div>

    {#if createError}
      <div
        class="shrink-0 border-t border-border/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground/90"
        role="alert"
      >
        {createError}
      </div>
    {/if}

    <footer
      class="flex shrink-0 items-center gap-2 border-t border-border/40 bg-muted/10 px-4 py-3"
    >
      {#if mode === 'directory' && onCreateDirectory}
        {#if newFolderOpen}
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              bind:this={newFolderInputRef}
              bind:value={newFolderName}
              type="text"
              class={cn(
                'min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm text-foreground outline-none',
                createError ? 'border-destructive/60' : 'border-border focus:border-foreground/40',
              )}
              placeholder={m.onboarding_dirPicker_newFolderName_placeholder()}
              aria-label={m.onboarding_dirPicker_newFolderName_ariaLabel()}
              aria-invalid={createError ? true : undefined}
              spellcheck="false"
              autocomplete="off"
              onkeydown={handleNewFolderKeydown}
            />
          </div>
        {:else}
          <button
            type="button"
            class={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              listing && !loading
                ? 'cursor-pointer text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                : 'cursor-not-allowed text-muted-foreground/40',
            )}
            disabled={!listing || loading}
            onclick={openNewFolder}
          >
            {m.onboarding_dirPicker_newFolder_label()}
          </button>
        {/if}
      {/if}
      <button
        type="button"
        class="ml-auto cursor-pointer rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        onclick={onClose}
      >
        {m.onboarding_dirPicker_cancel_label()}
      </button>
      <button
        type="button"
        class={cn(
          'rounded-md px-3 py-1.5 text-sm transition-colors',
          canSelect && !loading
            ? 'cursor-pointer bg-foreground text-background hover:bg-foreground/90'
            : 'cursor-not-allowed bg-muted/30 text-ghost',
        )}
        disabled={!canSelect || loading}
        onclick={handleSelect}
      >
        {selectLabel}
      </button>
    </footer>
  </div>
{/if}
