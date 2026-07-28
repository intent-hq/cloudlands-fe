<script lang="ts">
  /**
   * BE-driven shell for DirectoryPickerView. Directory reads remain in the
   * directory-picker read service; this component only dispatches intent.
   */
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  import Portal from '$lib/components/ui/Portal.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearCreateDirectoryError,
    clearPathNavigationError,
    createDirectoryRequested,
    loadDirectoryRequested,
    navigateToPathRequested,
    resetDirectoryPicker,
    type DirectoryPickerListing,
  } from '$store/renderer/slices/directory-picker/directory-picker-slice';
  import {
    selectDirectoryPickerCreateError,
    selectDirectoryPickerError,
    selectDirectoryPickerListing,
    selectDirectoryPickerLoading,
    selectDirectoryPickerPathError,
  } from '$store/renderer/slices/directory-picker/directory-picker-selectors';

  import DirectoryPickerView from './DirectoryPickerView.svelte';
  import { favoritesFromHome } from './directory-picker-view';

  interface Props {
    open: boolean;
    title?: string;
    /** Path to open initially. Empty/undefined opens the daemon-host home. */
    initialPath?: string;
    /** Submit-button label. Defaults to the label for the active mode. */
    selectLabel?: string;
    mode?: 'directory' | 'file';
    onSelect: (path: string) => void;
    onClose: () => void;
  }

  let {
    open,
    title,
    initialPath,
    selectLabel,
    mode = 'directory',
    onSelect,
    onClose,
  }: Props = $props();

  const modeDefaultLabel = $derived(
    mode === 'file'
      ? m.onboarding_dirPicker_selectFile_label()
      : m.onboarding_dirPicker_selectFolder_label(),
  );
  const resolvedTitle = $derived(title ?? modeDefaultLabel);
  const resolvedSelectLabel = $derived(selectLabel ?? modeDefaultLabel);

  const listing$ = selectDirectoryPickerListing();
  const loading$ = selectDirectoryPickerLoading();
  const error$ = selectDirectoryPickerError();
  const pathError$ = selectDirectoryPickerPathError();
  const createError$ = selectDirectoryPickerCreateError();
  const listing: DirectoryPickerListing | null = $derived($listing$);
  const loading: boolean = $derived($loading$);
  const error: string | null = $derived($error$);
  const pathError: string | null = $derived($pathError$);
  const createError: string | null = $derived($createError$);

  let loadedFor = $state<string | null>(null);
  const favorites = $derived(
    favoritesFromHome(listing?.home, {
      home: m.onboarding_dirPicker_home_label(),
      desktop: m.onboarding_dirPicker_desktop_label(),
      documents: m.onboarding_dirPicker_documents_label(),
      downloads: m.onboarding_dirPicker_downloads_label(),
      computer: m.onboarding_dirPicker_computer_label(),
    }),
  );

  function requestDirectory(path: string | undefined) {
    loadedFor = path ?? '';
    appStore.dispatch(loadDirectoryRequested(path));
  }

  function createDirectory(path: string) {
    appStore.dispatch(createDirectoryRequested(path));
  }

  $effect(() => {
    if (!open) return;
    const want = initialPath?.trim() || '';
    untrack(() => {
      if (loadedFor === null) requestDirectory(want || undefined);
    });
  });

  $effect(() => {
    if (!open) {
      loadedFor = null;
      appStore.dispatch(resetDirectoryPicker());
    }
  });

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((event) => {
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return false;
      onClose();
    });
  });
</script>

{#if open}
  <Portal target="body" zIndex={10000}>
    <div
      class="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      transition:fade={{ duration: 120 }}
      role="presentation"
      onclick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onkeydown={() => {}}
    >
      <div class="mx-4 w-full max-w-3xl" transition:fly={{ y: 8, duration: 160 }}>
        <DirectoryPickerView
          {open}
          title={resolvedTitle}
          selectLabel={resolvedSelectLabel}
          {mode}
          {listing}
          {loading}
          {error}
          {pathError}
          {createError}
          {favorites}
          showFiles={mode === 'file'}
          {onSelect}
          {onClose}
          onNavigate={requestDirectory}
          onNavigateToPath={(path) => appStore.dispatch(navigateToPathRequested(path))}
          onClearPathError={() => appStore.dispatch(clearPathNavigationError())}
          onCreateDirectory={createDirectory}
          onClearCreateError={() => appStore.dispatch(clearCreateDirectoryError())}
        />
      </div>
    </div>
  </Portal>
{/if}
