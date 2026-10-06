import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { DraftAttachment } from '$lib/client/app-client';

/** Composer draft content as persisted by PROTOCOL §5.16 `drafts.*`. */
export interface ChatDraftSnapshot {
  text: string;
  attachments: DraftAttachment[];
}

type ChatDraftRestoreStatus = 'pending' | 'restored' | 'failed';

/** Correlated `drafts.get` outcome for one draft owner (a mounted composer). */
export interface ChatDraftRestore {
  requestId: string;
  workspaceId: string;
  agentId: string;
  status: ChatDraftRestoreStatus;
  draft?: ChatDraftSnapshot | null;
  error?: string;
}

type ChatDraftSaveStatus = 'pending' | 'saved' | 'failed';

/** Correlated `drafts.set` outcome, kept until the owner acknowledges it. */
export interface ChatDraftSaveOutcome {
  id: string;
  workspaceId: string;
  agentId: string;
  status: ChatDraftSaveStatus;
  error?: string;
}

/**
 * Debounced save request. `rollback` is the owner's last known persisted
 * draft at schedule time; a failed write restores the switch-back cache to it.
 */
export interface ChatDraftSaveRequest {
  workspaceId: string;
  agentId: string;
  text: string;
  attachments: DraftAttachment[];
  rollback: ChatDraftSnapshot | null;
}

export interface ChatDraftOwner {
  id: string;
  restore: ChatDraftRestore | null;
  saves: Collection<ChatDraftSaveOutcome, 'id'>;
}

export interface ChatDraftOwnerView {
  restore: ChatDraftRestore | null;
  saves: ChatDraftSaveOutcome[];
}

export interface ChatDraftsState {
  owners: Collection<ChatDraftOwner, 'id'>;
}
