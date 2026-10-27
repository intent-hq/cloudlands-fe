import type { AgentMessage } from '$shared/types';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export interface DockConversationPrompt {
  workspaceId: string;
  agentId: string;
  text: string;
  contextItems: Omit<ContextItem, 'file'>[];
  forceSubmit?: boolean;
  /** Local editor correlation only; canonical delivery generates its own identity. */
  submissionId?: string;
}

export interface DockConversationAgent {
  id: string;
  name: string;
  isMain: boolean;
}
/** Preserve canonical blocks, authorship, notices and correlation for real chat rendering. */
export type DockConversationMessage = AgentMessage;
export interface DockConversationDraft {
  id: string;
  text: string;
  revision: number;
  restored: boolean;
  hasAttachments: boolean;
  retryRevision?: number;
  clearRevision?: number;
  clearSubmissionId?: string;
  recoverRevision?: number;
  delivery?: {
    reference: import('../pending-submissions/pending-submissions-types').SubmissionReference;
    revision: number;
    authority: string;
    settled?: boolean;
    contextFingerprint?: string;
    clearedRevision?: number;
    composerSubmissionId?: string;
    recovery?: {
      text: string;
      contextItems: Collection<DockConversationPrompt['contextItems'][number], 'id'>;
    };
  };
}
export interface DockConversationState {
  workspaceId: string | null;
  workspaceTitle: string;
  agentId: string | null;
  generation: number;
  identity: string | null;
  authority: string | null;
  agents: Collection<DockConversationAgent, 'id'>;
  drafts: Collection<DockConversationDraft, 'id'>;
  loading: boolean;
  error: string | null;
  sendError: string | null;
  sending: boolean;
}
