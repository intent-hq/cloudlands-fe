import type { TerminalMutationResult } from '../../../../lib/client/terminal-client-types';

export interface TerminalOperation {
  id: string;
  workspaceId: string;
  context: string;
  viewId: string;
  authorityKey: string;
  root: string;
  kind: 'create' | 'close';
  terminalId?: string;
  status: 'queued' | 'running' | 'confirmed' | 'failed' | 'unknown';
  result?: TerminalMutationResult;
  retired?: boolean;
}
export interface TerminalReadState {
  context: string;
  viewId: string;
  requestId: string;
  loading: boolean;
  error?: string;
}
