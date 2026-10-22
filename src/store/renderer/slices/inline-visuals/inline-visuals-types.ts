import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type {
  InlineVisualIdentity,
  InlineVisualRecord,
  InlineVisualSnapshot,
} from '$features/inline-html/inline-visual-types';

/** The host supplies every field; authored messages never supply file paths. */
export function inlineVisualKey(identity: InlineVisualIdentity): string {
  return JSON.stringify([
    identity.workspaceId,
    identity.agentId,
    identity.messageId,
    identity.blockKey,
    identity.source,
  ]);
}

export interface InlineVisualEntry {
  id: string;
  identity: InlineVisualIdentity;
  record: InlineVisualRecord;
  loaded: boolean;
  status: 'loading' | 'ready' | 'saving' | 'error';
  error?: string;
  revision: number;
  savedRevision: number;
  export?: {
    requestId: string;
    status: 'saving' | 'saved' | 'error';
    path?: string;
    error?: string;
  };
}

export interface InlineVisualDraft {
  id: string;
  ownerId: string;
  workspaceId: string;
  agentId: string;
  snapshot: InlineVisualSnapshot;
}

export interface InlineVisualsState {
  entries: Collection<InlineVisualEntry, 'id'>;
  drafts: Collection<InlineVisualDraft, 'id'>;
}
