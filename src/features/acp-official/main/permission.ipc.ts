/**
 * Permission IPC Handlers
 *
 * Bridges permission requests from main process (ACPServer/ACPProvider)
 * to the renderer permission UI via IPC.
 *
 * Flow:
 * 1. ACPProvider receives session/request_permission from auggie CLI
 * 2. ACPProvider calls permissionIPCBridge.requestPermission()
 * 3. This sends the request to renderer via webContents.send()
 * 4. Renderer permission UI shows and user responds
 * 5. Renderer sends response back via ipcMain.handle('permission:respond')
 * 6. Promise resolves and ACPProvider sends response to auggie CLI
 */

import { ipcMain, BrowserWindow, Notification } from 'electron';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import type { PermissionOption, RequestPermissionOutcome } from '../types/base';
import type { AgentId } from '../../../shared/types/branded-ids';

const logger = new Logger('PermissionIPC');

/**
 * Show a desktop notification for permission request
 */
function showPermissionNotification(
  title: string,
  targetWindow: BrowserWindow,
  agentName?: string,
): void {
  try {
    if (!Notification.isSupported()) {
      logger.debug('Desktop notifications not supported');
      return;
    }

    const notification = new Notification({
      title: agentName ? `${agentName} needs permission` : 'Permission Required',
      body: title,
    });

    // Focus the window when notification is clicked
    notification.on('click', () => {
      if (targetWindow && !targetWindow.isDestroyed()) {
        if (targetWindow.isMinimized()) {
          targetWindow.restore();
        }
        targetWindow.focus();
      }
    });

    notification.show();
    logger.debug('Permission notification shown', { title });
  } catch (error) {
    logger.error('Failed to show permission notification', error as Error);
  }
}

// Track pending permission requests (includes request data for recovery after page refresh)
const pendingRequests = new Map<
  string,
  {
    resolve: (outcome: RequestPermissionOutcome) => void;
    timeout: NodeJS.Timeout;
    data: PermissionRequestData;
  }
>();

let requestCounter = 0;

export interface PermissionRequestData {
  requestId: string;
  sessionId: string;
  title: string;
  description?: string | null;
  options: PermissionOption[];
  agentName?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  timestamp: number;
}

/**
 * Request permission from the user via renderer process
 */
export async function requestPermissionViaIPC(
  sessionId: AgentId,
  title: string,
  description?: string | null,
  options: PermissionOption[] = [],
  metadata?: {
    agentName?: string;
    riskLevel?: 'low' | 'medium' | 'high';
  },
): Promise<RequestPermissionOutcome> {
  const requestId = `perm_${Date.now()}_${++requestCounter}`;

  logger.info('Requesting permission via IPC', {
    requestId,
    sessionId,
    title,
    optionCount: options.length,
  });

  // Get the focused window to send the request to
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const allWindows = BrowserWindow.getAllWindows();
  const targetWindow = focusedWindow || allWindows[0];

  if (!targetWindow || targetWindow.isDestroyed()) {
    logger.error('No window available to show permission dialog');
    return { outcome: 'cancelled' };
  }

  // Ensure we have default options
  const defaultOptions: PermissionOption[] = [
    { id: 'allow_once', label: 'Allow' },
    { id: 'reject_once', label: 'Deny' },
  ];

  const requestData: PermissionRequestData = {
    requestId,
    sessionId: sessionId as string,
    title,
    description,
    options: options.length > 0 ? options : defaultOptions,
    agentName: metadata?.agentName,
    riskLevel: metadata?.riskLevel || assessRiskLevel(title),
    timestamp: Date.now(),
  };

  return new Promise((resolve) => {
    // Set timeout for auto-cancel (5 minutes)
    const timeout = setTimeout(
      () => {
        logger.warn('Permission request timed out after 5 minutes', { requestId, title });
        pendingRequests.delete(requestId);
        resolve({ outcome: 'cancelled' });
      },
      5 * 60 * 1000,
    );

    // Store request with data for recovery after page refresh
    pendingRequests.set(requestId, { resolve, timeout, data: requestData });

    // Show desktop notification to alert user
    showPermissionNotification(title, targetWindow, metadata?.agentName);

    // Send to renderer
    targetWindow.webContents.send(IPC_CHANNELS.PERMISSION.EVENT, requestData);
    logger.info('Sent permission request to renderer', { requestId, windowId: targetWindow.id });
  });
}

function assessRiskLevel(title: string): 'low' | 'medium' | 'high' {
  const lowRiskPatterns = /read|view|list|get/i;
  const highRiskPatterns = /delete|remove|execute|write|modify|create|launch/i;

  if (highRiskPatterns.test(title)) return 'high';
  if (lowRiskPatterns.test(title)) return 'low';
  return 'medium';
}

/**
 * Setup permission IPC handlers
 */
export function setupPermissionIPC(): void {
  logger.info('Setting up permission IPC handlers');

  // Handle permission response from renderer
  ipcMain.handle(
    IPC_CHANNELS.PERMISSION.RESPOND,
    async (
      _event,
      data: {
        requestId: string;
        outcome: RequestPermissionOutcome;
      },
    ) => {
      const { requestId, outcome } = data;
      logger.info('Received permission response from renderer', { requestId, outcome });

      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
        pending.resolve(outcome);
        return { success: true };
      } else {
        logger.warn('No pending request found for response', { requestId });
        return { success: false, error: 'No pending request found' };
      }
    },
  );

  // Handle request to get all pending permission requests (for page refresh recovery)
  ipcMain.handle(IPC_CHANNELS.PERMISSION.GET_PENDING, async () => {
    const pendingData: PermissionRequestData[] = [];
    for (const [, pending] of pendingRequests) {
      pendingData.push(pending.data);
    }
    logger.info('Returning pending permission requests', { count: pendingData.length });
    return { success: true, requests: pendingData };
  });

  logger.info('Permission IPC handlers setup complete');
}

// Export for use in ACPProvider
export const permissionIPCBridge = {
  requestPermission: requestPermissionViaIPC,
};
