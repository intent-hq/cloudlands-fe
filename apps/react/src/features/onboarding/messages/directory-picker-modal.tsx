// Source: src/features/onboarding/messages/DirectoryPickerModal.svelte.
// Directory operations belong to the saga; this container only dispatches intent.
import { useEffect, useEffectEvent, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { store } from '@/store';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';
import { m } from '$shared/paraglide/messages.js';
import {
  clearCreateDirectoryError,
  clearPathNavigationError,
  createDirectoryRequested,
  loadDirectoryRequested,
  navigateToPathRequested,
  resetDirectoryPicker,
  type DirectoryPickerListing,
} from '../../../../../../src/store/renderer/slices/directory-picker/directory-picker-slice';
import {
  selectDirectoryPickerCreateError,
  selectDirectoryPickerError,
  selectDirectoryPickerListing,
  selectDirectoryPickerLoading,
  selectDirectoryPickerPathError,
} from '@/store/directory-picker/directory-picker-selectors';
import { DirectoryPickerView } from './directory-picker-view';

export interface DirectoryPickerModalProps {
  open: boolean;
  static?: boolean;
  staticData?: { listing: DirectoryPickerListing };
  title?: string;
  /** Empty or undefined opens the daemon-host home. */
  initialPath?: string;
  /** Defaults to the active mode's submit label. */
  selectLabel?: string;
  mode?: 'directory' | 'file';
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function DirectoryPickerModal({
  open,
  static: staticPosition = false,
  staticData,
  title,
  initialPath,
  selectLabel,
  mode = 'directory',
  onSelect,
  onClose,
}: DirectoryPickerModalProps) {
  const loadedFor = useRef<string | null>(null);
  const modeDefaultLabel =
    mode === 'file'
      ? m.onboarding_dirPicker_selectFile_label()
      : m.onboarding_dirPicker_selectFolder_label();
  const resolvedTitle = title ?? modeDefaultLabel;

  // The app's Signals transform tracks live reads; static previews never read the Store.
  const listing = staticData ? staticData.listing : selectDirectoryPickerListing().value;
  const loading = staticData ? false : selectDirectoryPickerLoading().value;
  const error = staticData ? null : selectDirectoryPickerError().value;
  const pathError = staticData ? null : selectDirectoryPickerPathError().value;
  const createError = staticData ? null : selectDirectoryPickerCreateError().value;

  function requestDirectory(path?: string) {
    if (staticData) return;
    loadedFor.current = path ?? '';
    store.dispatch(loadDirectoryRequested(path));
  }

  useEffect(() => {
    if (staticData) return;
    if (!open) {
      loadedFor.current = null;
      store.dispatch(resetDirectoryPicker());
    } else if (loadedFor.current === null) {
      const path = initialPath?.trim() || '';
      loadedFor.current = path;
      store.dispatch(loadDirectoryRequested(path || undefined));
    }
  }, [open, initialPath, staticData]);

  const handleEscape = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      if (target.type === 'search') {
        // Bypass React's value tracker so its onChange updates the controlled search.
        // The shared capture layer consumes Escape before the dialog can swallow it.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(target, '');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      // Path and new-folder editors own cancellation of their current edit.
      return false;
    }
    onClose();
  });

  useEffect(() => {
    if (staticData || !open) return;
    return pushEscapeLayer((event) => handleEscape(event));
  }, [open, staticData]);

  return (
    <Dialog
      staticPosition={staticPosition}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex max-w-3xl flex-col gap-0 overflow-hidden rounded-lg border-0 bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">{resolvedTitle}</DialogTitle>
        <DirectoryPickerView
          embedded
          open={open}
          title={resolvedTitle}
          selectLabel={selectLabel ?? modeDefaultLabel}
          mode={mode}
          listing={listing}
          loading={loading}
          error={error}
          pathError={pathError}
          createError={createError}
          showFiles={mode === 'file'}
          onSelect={onSelect}
          onClose={onClose}
          onNavigate={requestDirectory}
          onNavigateToPath={(path) => {
            if (!staticData) store.dispatch(navigateToPathRequested(path));
          }}
          onClearPathError={() => {
            if (!staticData) store.dispatch(clearPathNavigationError());
          }}
          onCreateDirectory={(path) => {
            if (!staticData) store.dispatch(createDirectoryRequested(path));
          }}
          onClearCreateError={() => {
            if (!staticData) store.dispatch(clearCreateDirectoryError());
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default DirectoryPickerModal;
