import { store } from '../index';
import {
  downloadUpdate,
  installUpdate,
} from '../../../../../src/store/renderer/slices/auto-update/auto-update-slice';
import {
  selectAutoUpdateCurrentVersion,
  selectAutoUpdateError,
  selectAutoUpdateInfo,
  selectAutoUpdateProgress,
  selectAutoUpdateStatus,
} from './auto-update-selectors';

function onDownload(): void {
  store.dispatch(downloadUpdate());
}

function onInstall(): void {
  store.dispatch(installUpdate());
}

/** UpdateToast's presentation contract requires plain values, including preview overrides. */
export function useAutoUpdateToastState() {
  return {
    status: selectAutoUpdateStatus.useValue(),
    progress: selectAutoUpdateProgress.useValue(),
    updateInfo: selectAutoUpdateInfo.useValue(),
    currentVersion: selectAutoUpdateCurrentVersion.useValue(),
    error: selectAutoUpdateError.useValue(),
    onDownload,
    onInstall,
  };
}
