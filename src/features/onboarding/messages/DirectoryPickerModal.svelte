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
    directoryPickerSourceSet,
    loadDirectoryRequested,
    navigateToPathRequested,
    resetDirectoryPicker,
    type DirectoryPickerListing,
    type DirectoryPickerSource,
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
    mode?: 'directory' | 'file' | 'save';
    /** File mode: allow several files; the choice arrives through `onSelectMany`. */
    multiple?: boolean;
    /** Lowercase extensions without the dot; other files are hidden. */
    extensions?: string[];
    /** Save mode: the file name to start with. */
    defaultFileName?: string;
    /**
     * `daemon` (default) lists the daemon host; `local` lists the frontend host
     * through main, for the in-app stand-in of native file dialogs.
     */
    source?: DirectoryPickerSource;
    onSelect: (path: string) => void;
    onSelectMany?: (paths: string[]) => void;
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
    multiple = false,
    extensions,
    defaultFileName,
    source = 'daemon',
    onSelect,
    onSelectMany,
    onClose,
  }: Props = $props();

  const modeDefaultLabel = $derived(
    mode === 'save'
      ? m.onboarding_dirPicker_save_label()
      : mode === 'file'
        ? multiple
          ? m.onboarding_dirPicker_chooseFiles_title()
          : m.onboarding_dirPicker_selectFile_label()
        : m.onboarding_dirPicker_selectFolder_label(),
  );
  const resolvedTitle = $derived(
    title ?? (mode === 'save' ? m.onboarding_dirPicker_saveTitle_label() : modeDefaultLabel),
  );
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
    appStore.dispatch(directoryPickerSourceSet(source));
    appStore.dispatch(loadDirectoryRequested(path));
  }

  function createDirectory(path: string) {
    if (staticData) return;
    appStore.dispatch(directoryPickerSourceSet(source));
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
    class="flex max-w-3xl flex-col gap-0 overflow-hidden rounded-lg border-0 bg-transparent p-0 shadow-none"
  >
    <Dialog.Title class="sr-only">{resolvedTitle}</Dialog.Title>
    <DirectoryPickerView
      embedded
      {open}
      title={resolvedTitle}
      selectLabel={resolvedSelectLabel}
      {mode}
      {multiple}
      {extensions}
      {defaultFileName}
      {listing}
      {loading}
      {error}
      {pathError}
      {createError}
      {favorites}
      showFiles={mode !== 'directory'}
      {onSelect}
      {onSelectMany}
      {onClose}
      onNavigate={requestDirectory}
      onNavigateToPath={(path) => !staticData && appStore.dispatch(navigateToPathRequested(path))}
      onClearPathError={() => !staticData && appStore.dispatch(clearPathNavigationError())}
      onCreateDirectory={createDirectory}
      onClearCreateError={() => !staticData && appStore.dispatch(clearCreateDirectoryError())}
    />
  </Dialog.Content>
</Dialog.Root>
