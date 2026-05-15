/**
 * Agent IPC Client
 *
 * Minimal client-side wrapper for agent IPC communication.
 * Used by renderer process to communicate with main process.
 *
 * NOTE: Renderer agent creation should go through workspace-agent Redux actions/sagas,
 * not through this client. This client is only for runtime operations like setModel.
 */

import type { Result, CommandResponse } from '../../shared/types';
import { AGENT_CHANNELS } from '$shared/ipc/channels';

class AgentClient {
  private async invoke<T>(channel: string, data?: unknown): Promise<Result<T, string>> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const response = await window.electronAPI.invoke(channel, data);
        return this.commandResponseToResult<T>(response);
      }
      return { ok: false, error: 'IPC not available' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'IPC call failed',
      };
    }
  }

  private commandResponseToResult<T>(response: CommandResponse<T>): Result<T, string> {
    if (response.success && response.data !== undefined) {
      return { ok: true, data: response.data };
    } else {
      return { ok: false, error: response.error || 'Unknown error' };
    }
  }

  /**
   * Set the model for an agent session
   */
  async setModel(
    agentId: string,
    modelId: string,
    workspaceId: string,
  ): Promise<Result<{ success: boolean; modelId?: string; error?: string }, string>> {
    return this.invoke<{ success: boolean; modelId?: string; error?: string }>(
      AGENT_CHANNELS.SET_MODEL,
      { agentId, modelId, workspaceId },
    );
  }
}

export const agentClient = new AgentClient();
