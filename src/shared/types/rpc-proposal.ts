/** One call's outcome after an `rpc-call` approval (`agent.resolveRpcProposal`). */
export interface RpcProposalItem {
  index: number;
  backend: string;
  method: string;
  status: 'done' | 'failed' | 'unknown' | 'skipped';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type RpcProposalResolution =
  | {
      success: true;
      outcome: 'applied' | 'dismissed';
      items: RpcProposalItem[];
      expired?: boolean;
    }
  | { success: false; error: string };
