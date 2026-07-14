import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';

const logger = new Logger('BannerIPC');

// Promotional banner infrastructure has been retired (was hosted on cdn.augmentcode.com).
// The IPC handler is kept for backward compatibility but always returns empty data.
export function setupBannerIPC(): void {
  ipcMain.handle(IPC_CHANNELS.BANNER.FETCH, async () => {
    logger.debug('Banner fetch requested, returning empty (promotional banner infrastructure retired)');
    return { success: true, data: [] };
  });
}

