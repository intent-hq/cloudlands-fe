import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export interface PermissionRequest {
  requestId: string;
  workspaceId?: string;
  sessionId: string;
  title: string;
  description?: string | null;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    destructive?: boolean;
  }>;
  agentName?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  timestamp: number;
}

export type PermissionState = {
  /** All pending permission requests */
  requests: Collection<PermissionRequest, 'requestId'>;
};
