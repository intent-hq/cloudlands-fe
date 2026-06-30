<script lang="ts">
  /**
   * DirectoryPickerModal — BE-driven folder picker.
   *
   * Replaces `invoke('dialog:open', { directory: true })` for onboarding
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
  import { onMount } from 'svelte';
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
  import { cn } from '$lib/utils';
  import { store as appStore } from '$store/renderer/store';
  import {
    loadDirectoryRequested,
    resetDirectoryPicker,
    type DirectoryPickerEntry,
    type DirectoryPickerListing,
  } from '$store/renderer/slices/directory-picker/directory-picker-slice';
  import {
    selectDirectoryPickerError,
    selectDirectoryPickerListing,
    selectDirectoryPickerLoading,
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
  const listing: DirectoryPickerListing | null = $derived($listing$);
  const loading: boolean = $derived($loading$);
  const error: string | null = $derived($error$);

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

  // Re-load whenever the modal opens (or the requested initial path changes).
  $effect(() => {
    if (!open) return;
    const want = initialPath?.trim() || '';
    if (loadedFor !== want || listing === null) {
      requestDirectory(want || undefined);
    }
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

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
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

  let dialogRef = $state<HTMLDivElement | null>(null);
  onMount(() => {
    // Focus the dialog on mount so keyboard nav works without an extra click.
    dialogRef?.focus();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Overlay traps clicks and acts as a backdrop. Clicking it closes. -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
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
        <div
          class="flex-1 px-2 py-1 text-xs font-mono truncate text-muted-foreground"
          title={listing?.path ?? ''}
        >
          {displayPath || '…'}
        </div>
      </div>

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
{/if}
