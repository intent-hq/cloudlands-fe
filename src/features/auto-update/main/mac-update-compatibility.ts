import type { AppUpdater } from 'electron-updater';

/** Keep the ARM filename for clients already using it; both filenames publish ARM. */
export function macUpdateChannel(platform = process.platform, arch = process.arch) {
  return platform === 'darwin' && arch === 'arm64' ? { channel: 'latest-arm64' } : {};
}

/** Reject an unavailable architecture before electron-updater emits update-available. */
export function configureMacUpdateCompatibility(
  updater: Pick<AppUpdater, 'isUpdateSupported'>,
  platform = process.platform,
  arch = process.arch,
  runningUnderARM64Translation = false,
) {
  if (platform !== 'darwin') return;
  const supported = updater.isUpdateSupported.bind(updater);
  updater.isUpdateSupported = (info) => {
    const files = info.files?.length ? info.files : info.path ? [{ url: info.path }] : [];
    const zips = files.filter((file) => file.url.split(/[?#]/)[0].endsWith('.zip'));
    const isArmMac = arch === 'arm64' || runningUnderARM64Translation;
    if (!zips.some((file) => isArmMac || !file.url.includes('arm64'))) return false;
    return supported(info);
  };
}
