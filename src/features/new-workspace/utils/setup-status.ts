import type { DraftSource } from '$shared/types/workspace-draft';
import type { Capability, CapabilityStatus } from '../controller';
import { isSourceValid } from './source-validation';

export type SetupReadiness = 'checking' | 'ready' | 'attention';

interface SetupStatusInput {
  source: DraftSource | null;
  capabilities: Record<Capability, CapabilityStatus>;
  requiredCapabilities: Capability[];
}

export interface SetupStatus {
  readiness: SetupReadiness;
  canStart: boolean;
}

export function getSetupStatus({
  source,
  capabilities,
  requiredCapabilities,
}: SetupStatusInput): SetupStatus {
  if (!isSourceValid(source)) return { readiness: 'attention', canStart: false };

  const requiredStatuses = requiredCapabilities.map((capability) => capabilities[capability]);
  if (requiredStatuses.includes('missing')) return { readiness: 'attention', canStart: false };
  if (requiredStatuses.some((status) => status === 'pending' || status === 'unknown')) {
    return { readiness: 'checking', canStart: false };
  }
  return { readiness: 'ready', canStart: true };
}
