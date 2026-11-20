import { dialog } from '$lib/electron-bridge';
import { hasCapability } from '$lib/utils/platform-capabilities';
import { selectIsDaemonLocal } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import { store as appStore } from '$store/renderer/store';

interface PickOptions {
  title?: string;
  defaultPath?: string;
  openModal: () => void;
  onSelect: (path: string) => void | Promise<void>;
}

/**
 * A native dialog can only browse the frontend laptop's filesystem, so use it only when
 * the daemon is local; remote daemons must browse their own filesystem through the modal.
 */
async function pick(
  { title, defaultPath, openModal, onSelect }: PickOptions,
  openNative: (options: { title?: string; defaultPath?: string }) => Promise<string | null>,
): Promise<void> {
  const useNative = hasCapability('nativeDialogs') && selectIsDaemonLocal.select(appStore.state);

  if (!useNative) {
    openModal();
    return;
  }

  let path: string | null;
  try {
    path = await openNative({ title, defaultPath });
  } catch {
    openModal();
    return;
  }

  if (path !== null) await onSelect(path);
}

/** Pick a directory: native `dialog.openDirectory` when local, modal otherwise. */
export async function pickDirectory(options: PickOptions): Promise<void> {
  await pick(options, (o) => dialog.openDirectory(o));
}

/** Pick a file: native `dialog.openFile` when local, modal in file mode otherwise. */
export async function pickFile(options: PickOptions): Promise<void> {
  await pick(options, (o) => dialog.openFile(o));
}
