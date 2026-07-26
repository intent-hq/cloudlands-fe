<script lang="ts">
  /**
   * DirectoryPickerModal — BE-driven folder picker.
   *
   * Replaces the retired native-dialog directory picker for onboarding
   * folder pickers so directory browsing happens on the daemon host (via
   * `host.listDirectory`) rather than via Electron's native dialog on the
   * machine running the FE. This keeps folder browsing consistent across
   * local UDS and remote WSS transports.
   *
   * The `host.listDirectory` round-trip lives in the `directoryPicker` slice
   * + companion `directory-picker-read-service` middleware so the component
   * never imports the live backend transport directly (satisfies the
   * `intent/no-component-async-data-fetch` ESLint rule). Component-local UI
   * state (focused row, scroll container ref, last loaded path) stays here
   * because it is ephemeral and self-contained.
   */
  import { onMount, untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import {
    faFolder,
    faFolderOpen,
    faArrowUp,
    faSpinner,
    faXmark,
    faCodeBranch,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { cn } from '$lib/utils';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearPathNavigationError,
    loadDirectoryRequested,
    navigateToPathRequested,
    resetDirectoryPicker,
    type DirectoryPickerEntry,
    type DirectoryPickerListing,
  } from '$store/renderer/slices/directory-picker/directory-picker-slice';
  import {
    selectDirectoryPickerError,
    selectDirectoryPickerListing,
    selectDirectoryPickerLoading,
    selectDirectoryPickerPathError,
  } from '$store/renderer/slices/directory-picker/directory-picker-selectors';

  interface Props {
    open: boolean;
    title?: string;
    /** Path to open initially. Empty/undefined opens the daemon-host home. */
    initialPath?: string;
    /** Submit-button label. Defaults to "Select folder". */
    selectLabel?: string;
    onSelect: (path: string) => void;
    onClose: () => void;
  }

  let {
    open,
    title = 'Select folder',
    initialPath,
    selectLabel = 'Select folder',
    onSelect,
    onClose,
  }: Props = $props();

  // Selector readables — captured at component init per the store rules. The
  // read-service middleware updates these stores in response to the dispatches
  // below; the component renders purely from `$store` derefs.
  const listing$ = selectDirectoryPickerListing();
  const loading$ = selectDirectoryPickerLoading();
  const error$ = selectDirectoryPickerError();
  const pathError$ = selectDirectoryPickerPathError();
  const listing: DirectoryPickerListing | null = $derived($listing$);
  const loading: boolean = $derived($loading$);
  const error: string | null = $derived($error$);
  const pathError: string | null = $derived($pathError$);

  let focusedIndex = $state(0);
  let listContainerRef = $state<HTMLDivElement | null>(null);
  /** Track which path was loaded so re-opening the modal re-fetches a fresh listing. */
  let loadedFor = $state<string | null>(null);

  function requestDirectory(path: string | undefined) {
    focusedIndex = 0;
    loadedFor = path ?? '';
    appStore.dispatch(loadDirectoryRequested(path));
    // Defer scroll-into-view until DOM updates with the new listing.
    queueMicrotask(() => listContainerRef?.scrollTo({ top: 0 }));
  }

  // Re-load whenever the modal opens. `loadedFor` and `listing` are read via
  // `untrack` so that in-modal navigation (which sets `loadedFor` and eventually
  // updates `listing`) does not re-trigger this effect and snap the picker back
  // to `initialPath`. The close-effect resets `loadedFor` to `null`, so
  // `loadedFor === null` is the fresh-open signal.
  $effect(() => {
    if (!open) return;
    const want = initialPath?.trim() || '';
    untrack(() => {
      if (loadedFor === null) {
        requestDirectory(want || undefined);
      }
    });
  });

  // Reset transient state when the modal closes so the next open is clean.
  $effect(() => {
    if (!open) {
      loadedFor = null;
      appStore.dispatch(resetDirectoryPicker());
    }
  });

  function handleSelect() {
    if (!listing) return;
    onSelect(listing.path);
  }

  function navigateInto(entry: DirectoryPickerEntry) {
    if (!entry.isDirectory) return;
    requestDirectory(entry.path);
  }

  function navigateUp() {
    if (!listing?.parent) return;
    requestDirectory(listing.parent);
  }

  function navigateHome() {
    requestDirectory(undefined);
  }

  const directoryEntries = $derived(listing?.entries.filter((e) => e.isDirectory) ?? []);

  // Escape layer: registered only while open so stacked overlays dismiss one
  // at a time in LIFO order. Declines when the path input is focused — it
  // owns its own Escape (cancel edit) via handlePathInputKeydown.
  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((e) => {
      if (pathInputRef && e.target === pathInputRef) return false;
      onClose();
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    // The path input owns its own keyboard handling (Enter commit, Escape
    // cancel, plain text editing incl. Backspace) — never treat its keystrokes
    // as list navigation or modal close.
    if (pathInputRef && e.target === pathInputRef) return;
    const list = directoryEntries;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, Math.max(list.length - 1, 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      const entry = list[focusedIndex];
      if (entry) {
        e.preventDefault();
        navigateInto(entry);
      }
    } else if (e.key === 'Backspace') {
      if (listing?.parent) {
        e.preventDefault();
        navigateUp();
      }
    }
  }

  /** Collapse a daemon-host path under `home` to `~/...` for display. */
  const displayPath = $derived.by(() => {
    if (!listing) return '';
    const home = listing.home;
    if (home && listing.path === home) return '~';
    if (home && listing.path.startsWith(home + '/')) {
      return '~/' + listing.path.slice(home.length + 1);
    }
    return listing.path;
  });

  // --- Editable path input -------------------------------------------------
  // The path bar is a textbox: Enter/blur commits the typed path (navigating
  // there via `navigateToPathRequested`), Escape cancels and restores the
  // current path. While an edit is pending or failed, the typed value is kept
  // so the user can correct it; the draft re-syncs to `displayPath` whenever
  // the loaded listing actually changes (typed commit success or click nav).
  let pathInputRef = $state<HTMLInputElement | null>(null);
  let pathDraft = $state('');
  let pathEditing = $state(false);
  let lastListingPath: string | null = null;

  $effect(() => {
    const dp = displayPath;
    const path = listing?.path ?? null;
    untrack(() => {
      if (path !== lastListingPath) {
        lastListingPath = path;
        pathEditing = false;
      }
      if (!pathEditing) pathDraft = dp;
    });
  });

  /**
   * Expand a leading `~` to the daemon-host home before hitting the wire.
   *
   * This is a fast path only, not a correctness requirement: when no listing
   * (and thus no `home`) is available — e.g. the initial load failed — the raw
   * tilde path is sent unchanged, and the daemon expands leading `~` / `~/`
   * itself (`host.listDirectory`, monorepo#824).
   */
  function expandTypedPath(raw: string): string {
    const trimmed = raw.trim();
    const home = listing?.home;
    if (!home) return trimmed;
    if (trimmed === '~') return home;
    if (trimmed.startsWith('~/')) return home + trimmed.slice(1);
    return trimmed;
  }

  function commitPathInput() {
    if (!pathEditing) return;
    const target = expandTypedPath(pathDraft);
    if (!target) {
      cancelPathEdit();
      return;
    }
    if (listing && target === listing.path) {
      // No-op navigation: just leave edit mode and clear any stale hint.
      pathEditing = false;
      pathDraft = displayPath;
      if (pathError) appStore.dispatch(clearPathNavigationError());
      return;
    }
    appStore.dispatch(navigateToPathRequested(target));
  }

  function cancelPathEdit() {
    pathEditing = false;
    pathDraft = displayPath;
    if (pathError) appStore.dispatch(clearPathNavigationError());
    pathInputRef?.blur();
  }

  function handlePathInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPathInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelPathEdit();
    }
  }

  let dialogRef = $state<HTMLDivElement | null>(null);
  onMount(() => {
    // Focus the dialog on mount so keyboard nav works without an extra click.
    dialogRef?.focus();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!--
    Render through Portal so the overlay escapes any clipping/stacking ancestor
    (notably the Select.Content popover at z-[9999]) and sits strictly above it.
    The Portal container z-index (10000) is what wins over the popover; the inner
    `fixed inset-0` is the full-screen backdrop that blocks pointer interaction
    with everything behind it.
  -->
  <Portal target="body" zIndex={10000}>
    <!-- Overlay traps clicks and acts as a backdrop. Clicking it closes. -->
    <div
      class="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      transition:fade={{ duration: 120 }}
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onkeydown={() => {}}
    >
    <div
      bind:this={dialogRef}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      class="w-full max-w-xl mx-4 rounded-xl border border-border/50 bg-card shadow-2xl overflow-hidden focus:outline-none"
      transition:fly={{ y: 8, duration: 160 }}
    >
      <!-- Header: title + close -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div class="flex items-center gap-2 min-w-0">
          <Fa icon={faFolderOpen} class="text-muted-foreground shrink-0" />
          <h2 class="text-sm font-medium truncate">{title}</h2>
        </div>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/40 cursor-pointer"
          onclick={onClose}
          aria-label="Close folder picker"
        >
          <Fa icon={faXmark} size="sm" />
        </button>
      </div>

      <!-- Path bar: up button, current path, home shortcut -->
      <div class="flex items-center gap-1.5 px-3 py-2 border-b border-border/30 bg-muted/20">
        <button
          type="button"
          class={cn(
            'p-1.5 rounded hover:bg-muted/50 transition-colors',
            listing?.parent ? 'text-foreground cursor-pointer' : 'text-muted-foreground/40 cursor-not-allowed',
          )}
          disabled={!listing?.parent || loading}
          onclick={navigateUp}
          aria-label="Go up one level"
          title="Up (Backspace)"
        >
          <Fa icon={faArrowUp} size="sm" />
        </button>
        <button
          type="button"
          class="text-xs px-2 py-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground cursor-pointer"
          onclick={navigateHome}
          title="Home"
        >
          ~
        </button>
        <input
          bind:this={pathInputRef}
          bind:value={pathDraft}
          type="text"
          class={cn(
            'flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded bg-transparent text-muted-foreground',
            'border border-transparent focus:border-border focus:bg-background focus:text-foreground focus:outline-none',
            pathError && 'border-destructive/60 focus:border-destructive/60',
          )}
          placeholder="…"
          aria-label="Path"
          aria-invalid={pathError ? true : undefined}
          spellcheck="false"
          autocomplete="off"
          title={listing?.path ?? ''}
          oninput={() => (pathEditing = true)}
          onkeydown={handlePathInputKeydown}
          onblur={commitPathInput}
        />
      </div>

      <!-- Inline hint for a failed typed-path navigation -->
      {#if pathError}
        <div
          class="px-3 py-1.5 text-xs text-destructive-foreground/90 border-b border-border/30 bg-destructive/10"
          role="alert"
        >
          {pathError}
        </div>
      {/if}

      <!-- Directory list -->
      <div
        bind:this={listContainerRef}
        class="max-h-80 overflow-y-auto"
        role="listbox"
        aria-label="Directory contents"
      >
        {#if loading}
          <div class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Fa icon={faSpinner} class="animate-spin" size="sm" />
            <span>Loading…</span>
          </div>
        {:else if error}
          <div class="px-4 py-6 text-sm text-destructive-foreground/90">
            <p class="font-medium mb-1">Couldn't read directory</p>
            <p class="text-xs text-muted-foreground break-all">{error}</p>
          </div>
        {:else if directoryEntries.length === 0}
          <div class="px-4 py-8 text-center text-sm text-muted-foreground">
            No subfolders here. Click "{selectLabel}" to pick this folder.
          </div>
        {:else}
          <ul class="divide-y divide-border/10">
            {#each directoryEntries as entry, index (entry.path)}
              {@const isFocused = index === focusedIndex}
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={isFocused}
                  class={cn(
                    'w-full flex items-center gap-2.5 px-4 py-2 text-left cursor-pointer transition-colors',
                    isFocused ? 'bg-muted/40' : 'hover:bg-muted/30',
                  )}
                  onclick={() => {
                    focusedIndex = index;
                    navigateInto(entry);
                  }}
                  onmousemove={() => (focusedIndex = index)}
                  ondblclick={() => navigateInto(entry)}
                >
                  <Fa
                    icon={faFolder}
                    class={entry.isGitRepo ? 'text-amber-500' : 'text-muted-foreground'}
                    size="sm"
                  />
                  <span class="text-sm truncate flex-1">{entry.name}</span>
                  {#if entry.isGitRepo}
                    <Fa icon={faCodeBranch} class="text-amber-500/70" size="xs" />
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Footer: cancel + select-current-directory -->
      <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40 bg-muted/10">
        <button
          type="button"
          class="text-sm px-3 py-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground cursor-pointer"
          onclick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          class={cn(
            'text-sm px-3 py-1.5 rounded-md transition-colors',
            listing ? 'bg-foreground text-background hover:bg-foreground/90 cursor-pointer' : 'bg-muted/30 text-muted-foreground/60 cursor-not-allowed',
          )}
          disabled={!listing || loading}
          onclick={handleSelect}
        >
          {selectLabel}
        </button>
      </div>
    </div>
  </div>
  </Portal>
{/if}
