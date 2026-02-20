/**
 * Keychain Access IPC Handlers
 *
 * Bridges keychain access consent requests from GitService to the renderer process.
 *
 * Flow:
 * 1. GitService detects keychain access risk before network operation
 * 2. GitService calls keychainIPCBridge.requestConsent()
 * 3. This sends the request to renderer via webContents.send()
 * 4. KeychainAccessModal shows UI and user responds
 * 5. Renderer sends response back via ipcMain.handle('git:keychain-consent-respond')
 * 6. Promise resolves and GitService continues or cancels the operation
 */

import { BrowserWindow, ipcMain, Notification } from 'electron';
import type { KeychainAccessRisk } from '../../../shared/git/git-env';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { Logger } from '../../../shared/logger';
import type { WorkspaceId } from '../../../shared/types';

const logger = new Logger('KeychainIPC');

export type KeychainConsentOutcome = 'allow' | 'deny' | 'cancelled';

export interface KeychainConsentRequest {
  requestId: string;
  workspaceId: string;
  operation: string;
  credentialHelper: string | null;
  remoteUrl: string | null;
  reason: string;
  timestamp: number;
}

// Track pending consent requests
const pendingRequests = new Map<
  string,
  {
    resolve: (outcome: KeychainConsentOutcome) => void;
    timeout: NodeJS.Timeout;
  }
>();

let requestCounter = 0;

/**
 * Show a desktop notification for keychain consent
 */
function showKeychainNotification(operation: string, targetWindow: BrowserWindow): void {
  try {
    if (!Notification.isSupported()) {
      logger.debug('Desktop notifications not supported');
      return;
    }

    const notification = new Notification({
      title: 'Keychain Access Required',
      body: `Git ${operation} needs to access your keychain credentials`,
    });

    notification.on('click', () => {
      if (targetWindow && !targetWindow.isDestroyed()) {
        if (targetWindow.isMinimized()) {
          targetWindow.restore();
        }
        targetWindow.focus();
      }
    });

    notification.show();
    logger.debug('Keychain notification shown', { operation });
  } catch (error) {
    logger.error('Failed to show keychain notification', error as Error);
  }
}

/**
 * Check stored keychain preference from settings
 */
async function getStoredKeychainPreference(): Promise<'ask' | 'allow' | 'deny'> {
  try {
    // Import electron-store dynamically to get the stored preference
    // IMPORTANT: Must use { name: 'settings' } to match the store used by system.ipc.ts
    // which is where the renderer saves settings via 'settings:set' IPC channel
    const { default: Store } = await import('electron-store');
    const store = new Store({ name: 'settings' });
    const settings = store.get('keychainSettings') as
      | { keychainAccessChoice?: 'ask' | 'allow' | 'deny' }
      | undefined;
    logger.debug('Read keychain preference from settings store', {
      keychainAccessChoice: settings?.keychainAccessChoice ?? 'ask',
    });
    return settings?.keychainAccessChoice ?? 'ask';
  } catch (error) {
    logger.warn('Failed to get stored keychain preference, defaulting to ask', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return 'ask';
  }
}

/**
 * Request keychain access consent from the user via renderer process
 */
export async function requestKeychainConsentViaIPC(
  workspaceId: WorkspaceId,
  operation: string,
  risk: KeychainAccessRisk,
): Promise<KeychainConsentOutcome> {
  // First, check if user has already made a permanent choice
  const storedPreference = await getStoredKeychainPreference();
  if (storedPreference === 'allow') {
    logger.info('User has previously allowed keychain access, proceeding', {
      workspaceId,
      operation,
    });
    return 'allow';
  }
  if (storedPreference === 'deny') {
    logger.info('User has previously denied keychain access, blocking', {
      workspaceId,
      operation,
    });
    return 'deny';
  }

  const requestId = `keychain_${Date.now()}_${++requestCounter}`;

  logger.info('Requesting keychain consent via IPC', {
    requestId,
    workspaceId,
    operation,
    credentialHelper: risk.credentialHelper,
  });

  // Get window to send request to
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const allWindows = BrowserWindow.getAllWindows();
  const targetWindow = focusedWindow || allWindows[0];

  if (!targetWindow || targetWindow.isDestroyed()) {
    logger.warn('No window available for keychain consent dialog, allowing by default');
    return 'allow';
  }

  const requestData: KeychainConsentRequest = {
    requestId,
    workspaceId: workspaceId as string,
    operation,
    credentialHelper: risk.credentialHelper,
    remoteUrl: risk.remoteUrl,
    reason: risk.reason,
    timestamp: Date.now(),
  };

  return new Promise((resolve) => {
    // Set timeout for auto-allow (2 minutes - shorter than permission since it's less critical)
    const timeout = setTimeout(
      () => {
        logger.warn('Keychain consent request timed out, allowing by default', { requestId });
        pendingRequests.delete(requestId);
        resolve('allow');
      },
      2 * 60 * 1000,
    );

    pendingRequests.set(requestId, { resolve, timeout });

    // Show desktop notification
    showKeychainNotification(operation, targetWindow);

    // Send to renderer
    targetWindow.webContents.send(IPC_CHANNELS.GIT.KEYCHAIN_ACCESS_WARNING, requestData);
    logger.info('Sent keychain consent request to renderer', { requestId });
  });
}

/**
 * Setup keychain IPC handlers
 */
export function setupKeychainIPC(): void {
  logger.info('Setting up keychain IPC handlers');

  // Handle consent response from renderer
  ipcMain.handle(
    IPC_CHANNELS.GIT.KEYCHAIN_CONSENT_RESPOND,
    async (
      _event,
      data: {
        requestId: string;
        outcome: KeychainConsentOutcome;
      },
    ) => {
      const { requestId, outcome } = data;
      logger.info('Received keychain consent response', { requestId, outcome });

      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
        pending.resolve(outcome);
        return { success: true };
      } else {
        logger.warn('No pending keychain request found for response', { requestId });
        return { success: false, error: 'No pending request found' };
      }
    },
  );

  logger.info('Keychain IPC handlers setup complete');
}

// Export for use in GitService
export const keychainIPCBridge = {
  requestConsent: requestKeychainConsentViaIPC,
};
