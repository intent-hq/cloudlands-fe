import { dialog } from '$lib/electron-bridge';
import { hasCapability } from '$lib/utils/platform-capabilities';
import { selectIsDaemonLocal } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import { store as appStore } from '$store/renderer/store';

interface PickDirectoryOptions {
  title?: string;
  defaultPath?: string;
  openModal: () => void;
  onSelect: (path: string) => void | Promise<void>;
}

/**
 * A native dialog can only browse the frontend laptop's filesystem, so use it only when
 * the daemon is local; remote daemons must browse their own filesystem through the modal.
 */
export async function pickDirectory({
  title,
  defaultPath,
  openModal,
  onSelect,
}: PickDirectoryOptions): Promise<void> {
  const useNative = hasCapability('nativeDialogs') && selectIsDaemonLocal.select(appStore.state);

  if (!useNative) {
    openModal();
    return;
  }

  let path: string | null;
  try {
    path = await dialog.openDirectory({ title, defaultPath });
  } catch {
    openModal();
    return;
  }

  if (path !== null) await onSelect(path);
}
