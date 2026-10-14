import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

export type PRDisplayStatus = 'open' | 'merged' | 'closed' | 'draft';

export interface WorkspacePRPresentationRow {
  identity: string;
  number: number;
  title: string;
  url: string;
  repo: string | undefined;
  repoContext: string | undefined;
  status: PRDisplayStatus;
  /** Open PR reported by its monitor snapshot as sitting in the merge queue.
   * The `status` stays `open` (ordering and `data-pr-status` are unchanged);
   * only `accessibleStateLabel` / `details` say "Queued". */
  queued: boolean;
  statusIcon: IconDefinition;
  foregroundClass: string;
  backgroundClass: string;
  accessibleStateLabel: string;
  details: string;
  monitorAgentId: string | undefined;
  monitorOnly: boolean;
}
