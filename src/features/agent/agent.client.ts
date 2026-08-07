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
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';

class AgentClient {
  private async invoke<T>(channel: string, data?: unknown): Promise<Result<T, string>> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const response = await invokeIpc<CommandResponse<T>>(channel, data);
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
      return { ok: false, error: response.error || m.agent_client_unknown_error() };
    }
  }

  /**
   * Set the model for an agent session. `providerId` names the provider the
   * picked model belongs to — required to resolve a bare modelId when it
   * targets a provider other than the session's current one.
   */
  async setModel(
    agentId: string,
    modelId: string,
    workspaceId: string,
    providerId?: string,
  ): Promise<Result<{ success: boolean; modelId?: string; error?: string }, string>> {
    return this.invoke<{ success: boolean; modelId?: string; error?: string }>(
      AGENT_CHANNELS.SET_MODEL,
      { agentId, modelId, workspaceId, ...(providerId ? { providerId } : {}) },
    );
  }
}

export const agentClient = new AgentClient();
