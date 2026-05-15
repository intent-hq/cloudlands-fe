import {
  invoke,
  isElectron,
} from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('Clipboard');

interface ClipboardWriteResponse {
  success?: boolean;
  error?: string;
}

export async function writeTextToClipboard(text: string): Promise<void> {
  let electronError: unknown;

  if (isElectron()) {
    try {
      const result = await invoke<ClipboardWriteResponse>('system:write-clipboard', { text });
      if (result?.success === false) {
        throw new Error(result.error || 'Electron clipboard write failed');
      }
      return;
    } catch (error) {
      electronError = error;
      logger.warn('Electron clipboard write failed; falling back to browser clipboard', { error });
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      logger.error('Browser clipboard write failed', error, { electronError });
      throw error;
    }
  }

  logger.error('No clipboard write API is available', undefined, { electronError });
  throw electronError instanceof Error ? electronError : new Error('Clipboard write API unavailable');
}