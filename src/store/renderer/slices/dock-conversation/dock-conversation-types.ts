import type { AgentMessage } from '$shared/types';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type {
  DockComposerEvidence,
  DockEvidenceCapabilities,
  DockMarkTool,
  DockServerCapabilities,
} from '$shared/dock-evidence';
import type { DockSpeechCapability } from '$shared/dock-speech';

/**
 * The native dictation session of the open pair, owned by the root native-session
 * saga. Serializable mirror only; the adapter and transcript merger live in the saga.
 */
export interface DockNativeSpeechState {
  /** `dockEvidenceId(workspaceId, agentId)` of the installed native session; null when none. */
  pairId: string | null;
  capability: DockSpeechCapability | null;
  /** Live speech session id; null when not dictating. */
  activeId: string | null;
  /** A start is awaiting the helper's ready event. */
  pending: boolean;
  /** Last native speech error code (start, fatal, or stop barrier). */
  error: string | null;
  /** Oldest → newest normalized input levels. */
  levels: number[];
  /**
   * Settled explicit stop requests (the send's final-transcript barrier), newest last
   * and bounded. Kept per request so concurrent stops never overwrite each other.
   */
  stops: Collection<{ requestId: string; ok: boolean }, 'requestId'>;
}

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
    /** Evidence content the click snapshotted; later captures or marks are never cleared. */
    evidenceFingerprint?: string;
    clearedRevision?: number;
    composerSubmissionId?: string;
    recovery?: {
      text: string;
      contextItems: Collection<DockConversationPrompt['contextItems'][number], 'id'>;
      evidence?: DockComposerEvidence;
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
  /** Screen evidence per draft pair, keyed like `drafts`. */
  evidence: Collection<DockComposerEvidence, 'id'>;
  /** Last annotate tool per workspace; absent means pick. */
  toolByWorkspace: Record<string, DockMarkTool>;
  /**
   * Tool remembered from an earlier app session, per workspace. It is the
   * current tool until one is chosen here, but does not count as used (the
   * annotate button keeps its pencil until a tool is used this session).
   */
  rememberedToolByWorkspace: Record<string, DockMarkTool>;
  /** Installed native capabilities; null when no native boundary is installed. */
  nativeCapabilities: DockEvidenceCapabilities | null;
  /** Last observed server capabilities and the connection they belong to. */
  serverCapabilities: DockServerCapabilities | null;
  nativeSpeech: DockNativeSpeechState;
  loading: boolean;
  error: string | null;
  sendError: string | null;
  sending: boolean;
}
