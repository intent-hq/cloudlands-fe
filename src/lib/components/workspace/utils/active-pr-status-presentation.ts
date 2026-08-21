import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCodeMerge, faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
import type { WorkspaceActivePrStatus } from '$store/renderer/slices/workspace/workspace-types';

export interface ActivePrStatusPresentation {
  icon: IconDefinition;
  className: string;
}

/**
 * Status icon + color for the active-PR summary chip, mirroring the PR row
 * styling in `PRSection.svelte` (open → emerald, merged → purple + merge
 * icon, closed → red, draft/unknown → subtle).
 */
export function getActivePrStatusPresentation(
  status: WorkspaceActivePrStatus,
): ActivePrStatusPresentation {
  return {
    icon: status === 'merged' ? faCodeMerge : faCodePullRequest,
    className:
      status === 'open'
        ? 'text-emerald-500'
        : status === 'merged'
          ? 'text-purple-500'
          : status === 'closed'
            ? 'text-red-500'
            : 'text-subtle',
  };
}
