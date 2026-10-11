import { m } from '$shared/paraglide/messages.js';
import {
  AUTO_UPDATE_CHANNELS,
  type UpdateChannel,
  type UpdateProgress,
  type UpdateState,
} from '../../../../../src/features/auto-update/types';

/** The narrow preload contract; importing its implementation loads Electron code. */
interface AutoUpdatePreload {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on<T>(channel: string, callback: (data: T) => void): string;
  offById(channel: string, listenerId: string): void;
}

interface AutoUpdateResponse<T = void> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

// i18n-ignore (source bridge failure envelope, preserved verbatim)
const NOT_AVAILABLE = 'Auto-update is not available in this build';

function getPreload(): AutoUpdatePreload | undefined {
  const bridge =
    typeof window !== 'undefined'
      ? (window as Window & { electronAPI?: AutoUpdatePreload }).electronAPI
      : undefined;
  return bridge &&
    typeof bridge.invoke === 'function' &&
    typeof bridge.on === 'function' &&
    typeof bridge.offById === 'function'
    ? bridge
    : undefined;
}

/** Only a real preload can start the event session; mutation watchers still run in web. */
export function hasAutoUpdatePreload(): boolean {
  return getPreload() !== undefined;
}

async function invoke<T = void>(
  channel: string,
  payload?: unknown,
): Promise<AutoUpdateResponse<T>> {
  const bridge = getPreload();
  if (!bridge) return { success: false, error: { message: NOT_AVAILABLE } };
  // Match auto-update-bridge-seeder: exactly one optional payload, no mock router.
  return (await bridge.invoke(channel, payload)) as AutoUpdateResponse<T>;
}

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const bridge = getPreload();
  if (!bridge) throw new Error(NOT_AVAILABLE);
  const listenerId = bridge.on(channel, callback);
  return () => {
    if (listenerId) bridge.offById(channel, listenerId);
  };
}

/** Direct Electron transport with the source client's request and error contracts. */
export const autoUpdateClient = {
  async checkForUpdatesManual(): Promise<UpdateState> {
    const response = await invoke<UpdateState>(AUTO_UPDATE_CHANNELS.CHECK_MANUAL);
    if (!response.success || response.data === undefined) {
      throw new Error(response.error?.message || m.autoUpdate_client_checkFailed_error());
    }
    return response.data;
  },

  async downloadUpdate(): Promise<void> {
    const response = await invoke(AUTO_UPDATE_CHANNELS.DOWNLOAD);
    if (!response.success) {
      throw new Error(response.error?.message || m.autoUpdate_client_downloadFailed_error());
    }
  },

  async installUpdate(): Promise<void> {
    const response = await invoke(AUTO_UPDATE_CHANNELS.INSTALL);
    if (!response.success) {
      throw new Error(response.error?.message || m.autoUpdate_client_installFailed_error());
    }
  },

  async getState(): Promise<UpdateState> {
    const response = await invoke<UpdateState>(AUTO_UPDATE_CHANNELS.GET_STATE);
    if (!response.success || response.data === undefined) {
      throw new Error(response.error?.message || m.autoUpdate_client_getStateFailed_error());
    }
    return response.data;
  },

  async setChannel(channel: UpdateChannel): Promise<void> {
    const response = await invoke(AUTO_UPDATE_CHANNELS.SET_CHANNEL, { channel });
    if (!response.success) {
      throw new Error(response.error?.message || m.autoUpdate_client_setChannelFailed_error());
    }
  },

  onStatusChanged(callback: (state: UpdateState) => void): () => void {
    return subscribe(AUTO_UPDATE_CHANNELS.STATUS_CHANGED, callback);
  },

  onProgress(callback: (progress: UpdateProgress) => void): () => void {
    return subscribe(AUTO_UPDATE_CHANNELS.PROGRESS, callback);
  },

  onError(callback: (error: string) => void): () => void {
    return subscribe(AUTO_UPDATE_CHANNELS.ERROR, callback);
  },

  onShowToast(callback: () => void): () => void {
    return subscribe(AUTO_UPDATE_CHANNELS.SHOW_TOAST, callback);
  },

  onUpToDate(callback: (data: { version: string; isDev?: boolean }) => void): () => void {
    return subscribe(AUTO_UPDATE_CHANNELS.UP_TO_DATE, callback);
  },
};
