<script lang="ts">
  /**
   * BE-driven shell for DirectoryPickerView. Directory reads remain in the
   * directory-picker read service; this component only dispatches intent.
   */
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
      ? m.workspaceCreation_dirPicker_selectFile_label()
      : m.workspaceCreation_dirPicker_selectFolder_label(),
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
    directoryPickerFavorites(listing, {
      home: m.workspaceCreation_dirPicker_home_label(),
      desktop: m.workspaceCreation_dirPicker_desktop_label(),
      documents: m.workspaceCreation_dirPicker_documents_label(),
      downloads: m.workspaceCreation_dirPicker_downloads_label(),
      computer: m.workspaceCreation_dirPicker_computer_label(),
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
    class="max-w-3xl gap-0 border-0 bg-transparent p-0 shadow-none"
  >
    <Dialog.Title class="sr-only">{resolvedTitle}</Dialog.Title>
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
  </Dialog.Content>
</Dialog.Root>
