import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';

const logger = new Logger('BannerIPC');

const PROMOTIONAL_BANNER_URL = 'https://cdn.augmentcode.com/stable/banner.json';
const PROMOTIONAL_BANNER_TIMEOUT_MS = 5_000;

export function setupBannerIPC(): void {
  ipcMain.handle(IPC_CHANNELS.BANNER.FETCH, async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROMOTIONAL_BANNER_TIMEOUT_MS);

      try {
        const response = await fetch(PROMOTIONAL_BANNER_URL, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch banners: ${response.status}`);
        }

        const data = await response.json();
        return { success: true, data };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      logger.warn('Failed to fetch promotional banners', { error: (error as Error).message });
      return { success: false, data: [] };
    }
  });
}

