import type { AppUpdater } from 'electron-updater';

/** Reject an unavailable architecture before electron-updater emits update-available. */
export function configureMacUpdateCompatibility(
  updater: Pick<AppUpdater, 'isUpdateSupported'>,
  platform = process.platform,
  arch = process.arch,
) {
  if (platform !== 'darwin') return;
  const supported = updater.isUpdateSupported.bind(updater);
  updater.isUpdateSupported = (info) => {
    const files = info.files?.length ? info.files : info.path ? [{ url: info.path }] : [];
    const zips = files.filter((file) => file.url.split(/[?#]/)[0].endsWith('.zip'));
    // Mirror MacUpdater's Intel exclusion. ARM can also consume historical
    // universal/x64 archives, but a native ARM feed always supplies native files.
    if (!zips.some((file) => arch === 'arm64' || !file.url.includes('arm64'))) return false;
    return supported(info);
  };
}
