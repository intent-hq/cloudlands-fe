<script lang="ts">
  /**
   * BE-driven shell for DirectoryPickerView. Directory reads remain in the
   * directory-picker read service; this component only dispatches intent.
   */
  import { readable } from 'svelte/store';
  import { untrack } from 'svelte';

  import * as Dialog from '$lib/components/ui/dialog';
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
  import { directoryPickerFavorites } from './directory-picker-view';

  interface Props {
    open: boolean;
    static?: boolean;
    staticData?: { listing: DirectoryPickerListing };
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
    static: staticPosition = false,
    staticData,
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

  const listing$ = untrack(() =>
    staticData ? readable(staticData.listing) : selectDirectoryPickerListing(),
  );
  const loading$ = untrack(() => (staticData ? readable(false) : selectDirectoryPickerLoading()));
  const error$ = untrack(() => (staticData ? readable(null) : selectDirectoryPickerError()));
  const pathError$ = untrack(() =>
    staticData ? readable(null) : selectDirectoryPickerPathError(),
  );
  const createError$ = untrack(() =>
    staticData ? readable(null) : selectDirectoryPickerCreateError(),
  );
  const listing: DirectoryPickerListing | null = $derived($listing$);
  const loading: boolean = $derived($loading$);
  const error: string | null = $derived($error$);
  const pathError: string | null = $derived($pathError$);
  const createError: string | null = $derived($createError$);

  let loadedFor = $state<string | null>(null);
  const favorites = $derived(
    directoryPickerFavorites(listing, {
      home: m.onboarding_dirPicker_home_label(),
      desktop: m.onboarding_dirPicker_desktop_label(),
      documents: m.onboarding_dirPicker_documents_label(),
      downloads: m.onboarding_dirPicker_downloads_label(),
      computer: m.onboarding_dirPicker_computer_label(),
    }),
  );

  function requestDirectory(path: string | undefined) {
    if (staticData) return;
    loadedFor = path ?? '';
    appStore.dispatch(loadDirectoryRequested(path));
  }

  function createDirectory(path: string) {
    if (staticData) return;
    appStore.dispatch(createDirectoryRequested(path));
  }

  $effect(() => {
    if (staticData || !open) return;
    const want = initialPath?.trim() || '';
    untrack(() => {
      if (loadedFor === null) requestDirectory(want || undefined);
    });
  });

  $effect(() => {
    if (!staticData && !open) {
      loadedFor = null;
      appStore.dispatch(resetDirectoryPicker());
    }
  });

  $effect(() => {
    if (staticData || !open) return;
    return pushEscapeLayer((event) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement) {
        // bits-ui's document-level EscapeLayer preventDefaults every Escape it
        // sees (even with escapeKeydownBehavior="ignore"), which would stop
        // DirectoryPickerView's window-level handler from clearing the search
        // box. Clear it here and consume the event instead.
        if (target.type === 'search') {
          target.value = '';
          target.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        // Decline: the path / new-folder input's own handler cancels its edit.
        return false;
      }
      onClose();
    });
  });
</script>

<Dialog.Root
  {staticPosition}
  bind:open={
    () => open,
    (next) => {
      if (!next) onClose();
    }
  }
>
  <Dialog.Content
    showCloseButton={false}
    escapeKeydownBehavior="ignore"
    onOpenAutoFocus={(event) => event.preventDefault()}
    class="max-w-3xl gap-0 overflow-hidden rounded-lg border-0 bg-transparent p-0 shadow-none"
  >
    <Dialog.Title class="sr-only">{resolvedTitle}</Dialog.Title>
    <DirectoryPickerView
      embedded
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
      onNavigateToPath={(path) => !staticData && appStore.dispatch(navigateToPathRequested(path))}
      onClearPathError={() => !staticData && appStore.dispatch(clearPathNavigationError())}
      onCreateDirectory={createDirectory}
      onClearCreateError={() => !staticData && appStore.dispatch(clearCreateDirectoryError())}
    />
  </Dialog.Content>
</Dialog.Root>
