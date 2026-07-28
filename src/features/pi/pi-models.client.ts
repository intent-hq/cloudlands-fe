/**
 * Pi Models Client
 *
 * Client-side functions for the Pi MCP adapter. Model listing goes through
 * the shared provider models client
 * (`$features/providers/provider-models.client`).
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { PI_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('PiModelsClient');

export interface InstallPiMcpAdapterResponse {
  success: boolean;
  error?: string;
}

export async function checkPiMcpAdapterInstalled(): Promise<boolean> {
  if (typeof window === 'undefined') {
    logger.debug('Skipping Pi MCP adapter check - not in browser environment');
    return true;
  }

  return await invoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER);
}

export async function installPiMcpAdapter(): Promise<InstallPiMcpAdapterResponse> {
  if (typeof window === 'undefined') {
    logger.debug('Skipping Pi MCP adapter install - not in browser environment');
    return { success: false, error: m.pi_client_appOnly_error() };
  }

  return await invoke<InstallPiMcpAdapterResponse>(PI_CHANNELS.INSTALL_MCP_ADAPTER);
}
