export type PrBranchLookupStatus = 'loading' | 'succeeded' | 'failed';

export interface PrBranchLookupRequest {
  owner: string;
  repo: string;
  prNumber: number;
}

export interface PrBranchLookupPayload extends PrBranchLookupRequest {
  key: string;
}

export interface PrBranchLookupEntry {
  status: PrBranchLookupStatus;
  branch?: string;
  error?: string;
}

export interface PrBranchLookupState {
  byKey: Record<string, PrBranchLookupEntry>;
}
