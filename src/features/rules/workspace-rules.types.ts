/**
 * Workspace Rules Types
 *
 * Type definitions for workspace rules functionality
 */

export interface WorkspaceRulesConfig {
  enabled: boolean;
  content: string;
  updatedAt: string;
}

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export type GetRulesResponse = IPCResponse<WorkspaceRulesConfig>;
export type GetFormattedResponse = IPCResponse<string>;
export type UpdateRulesResponse = IPCResponse<WorkspaceRulesConfig>;
export type SetEnabledResponse = IPCResponse<void>;
export type ExportRulesResponse = IPCResponse<string>;
export type ImportRulesResponse = IPCResponse<void>;
export type GetCombinedPromptResponse = IPCResponse<string>;
