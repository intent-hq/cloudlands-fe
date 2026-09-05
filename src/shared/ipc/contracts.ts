/**
 * IPC Type Contracts
 *
 * Defines type-safe request/response contracts for all IPC channels.
 * Ensures type safety across the IPC boundary between main and renderer processes.
 *
 * Usage:
 *   const response = await typedInvoke('agent:create', {
 *     workspaceId: WorkspaceId('123'),
 *     workspacePath: '/path',
 *     name: 'Agent'
 *   });
 *   // response.data?.agent is typed as AgentSession
 */

/* eslint-disable @typescript-eslint/no-namespace */
import type { AgentId, WorkspaceId, MessageId } from '../types/branded-ids';
import type {
  AgentSession,
  CreateWorkspaceRequest,
  Workspace,
  WorkspaceDraft,
  WorkspaceDraftCreateInput,
  WorkspaceDraftUpdatePatch,
} from '../types';

/**
 * Base response type for all IPC calls
 */
export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// ============================================================================
// Agent IPC Contracts
// ============================================================================

export namespace AgentIpc {
  /**
   * Agent creation request
   *
   * NOTE: systemPrompt and rules are kept in IPC contract for backward compatibility
   * but are IGNORED by the backend. Frontend interfaces (UnifiedAgentConfig, CreateAgentOptions)
   * have these fields removed to prevent their use.
   *
   * The intentd daemon builds the system prompt from agentType.
   */
  export interface CreateRequest {
    workspaceId: WorkspaceId;
    workspacePath: string;
    name: string;
    agentId?: AgentId; // Optional: if provided, backend will use this ID instead of generating a new one
    nameExplicitlySet?: boolean; // Strict boolean on the wire (PROTOCOL §5.5): false marks a generated placeholder name; omitted keeps the daemon default
    model?: string;
    provider?: string; // Provider ID (e.g., 'auggie', 'claude-code', 'codex') - uses activeProviderStore.activeProviderId
    agentType?: string; // Agent type for specialization rules (debug, investigate, implement, etc.)
    behaviorPrompt?: string; // Custom behavior instructions for the agent (from specialist)
    systemPrompt?: string; // DEPRECATED: Kept for IPC backward compat, but IGNORED by backend
    rules?: string; // DEPRECATED: Kept for IPC backward compat, but IGNORED by backend
    initialMessage?: string;
    /**
     * Frontend createSession sends the initial prompt itself; backend-only callers omit this.
     */
    skipInitialPrompt?: boolean;
    contextReferences?: any[];
    imageBlocks?: Array<{ type: 'image'; data?: string; mimeType?: string; attachmentId?: string }>;
    metadata?: Record<string, any>;
    workspaceContext?: {
      openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
      linkedReferences: Array<{
        type: string;
        title: string;
        identifier?: string;
        url?: string;
      }>;
    };
  }

  export interface CreateResponse {
    agent: AgentSession;
    sessionId: AgentId;
  }

  export interface GetRequest {
    agentId: AgentId;
    workspaceId: WorkspaceId;
  }

  export interface GetResponse {
    agent: AgentSession | null;
  }

  export interface SendMessageRequest {
    agentId: AgentId;
    content: string;
    contextReferences?: any[];
    metadata?: Record<string, any>;
  }

  export interface SendMessageResponse {
    messageId: MessageId;
    /** Typed as AgentId because agentId is the canonical stream key (one stream per agent) */
    streamId: AgentId;
  }

  export interface ListRequest {
    workspaceId: WorkspaceId;
    includeDeleted?: boolean;
  }

  export interface ListResponse {
    agents: AgentSession[];
  }

  export interface SetModelRequest {
    agentId: AgentId;
    modelId: string;
    workspaceId: WorkspaceId;
    providerId?: string; // Explicit provider the picked model belongs to (daemon agent.setModel, PROTOCOL §5.5) — resolves bare ids on cross-provider picks
  }

  export interface SetModelResponse {
    success: boolean;
    modelId?: string;
    error?: string;
  }
}

export namespace WorkspaceDraftIpc {
  export type CreateRequest = WorkspaceDraftCreateInput;
  export type CreateResponse = WorkspaceDraft;
  export interface GetRequest {
    id: string;
  }
  export type GetResponse = WorkspaceDraft;
  export type ListRequest = Record<string, never>;
  export type ListResponse = WorkspaceDraft[];
  export interface UpdateRequest {
    id: string;
    expectedRevision: number;
    patch: WorkspaceDraftUpdatePatch;
  }
  export type UpdateResponse = WorkspaceDraft;
  export interface PromoteRequest {
    id: string;
    expectedRevision: number;
    initialAgent?: Omit<NonNullable<CreateWorkspaceRequest['initialAgent']>, 'agentId'>;
  }
  export interface PromoteResponse {
    draft: WorkspaceDraft;
    workspace: Workspace;
    initialAgent?: AgentSession;
  }
  export interface MarkDeliveryRequest {
    id: string;
    delivery: WorkspaceDraft['delivery'];
  }
  export type MarkDeliveryResponse = WorkspaceDraft;
  export interface DeleteRequest {
    id: string;
  }
  export interface DeleteResponse {
    deleted: boolean;
  }
}

// ============================================================================
// Workspace IPC Contracts
// ============================================================================

export namespace WorkspaceIpc {
  export interface CreateRequest {
    title: string;
    path?: string;
    template?: string;
    metadata?: Record<string, any>;
  }

  export interface CreateResponse {
    workspace: {
      id: WorkspaceId;
      title: string;
      path: string;
      createdAt: string;
    };
  }

  export interface GetRequest {
    workspaceId: WorkspaceId;
  }

  export interface GetResponse {
    workspace: {
      id: WorkspaceId;
      title: string;
      path: string;
      agents: AgentId[];
    } | null;
  }
}

// ============================================================================
// File IPC Contracts
// ============================================================================

export namespace FileIpc {
  export interface ReadRequest {
    path: string;
    encoding?: BufferEncoding;
    /** Maximum file size in bytes. If file exceeds this, returns an error. */
    maxSize?: number;
    /** If true, truncate content to maxSize instead of returning an error */
    truncateIfLarge?: boolean;
  }

  export interface ReadResponse {
    content: string;
    stats: {
      size: number;
      modified: string;
    };
    isBinary?: boolean; // Indicates if content is base64 encoded
    truncated?: boolean; // Indicates if content was truncated due to size limits
  }

  /** One bounded slice of a host-local file (large-file upload reads). */
  export interface ReadChunkRequest {
    path: string;
    /** Byte offset to start reading from. */
    offset: number;
    /** Bytes to read (≤ 16 MiB; the last chunk may return fewer). */
    length: number;
  }

  export interface ReadChunkResponse {
    /** Base64 of the bytes actually read. */
    content: string;
    bytesRead: number;
    /** Total file size at read time. */
    size: number;
  }

  export interface HashRequest {
    path: string;
  }

  export interface HashResponse {
    /** Lowercase hex SHA-256 of the full file contents. */
    sha256: string;
    /** Total bytes hashed (file size at hash time). */
    size: number;
  }

  export interface WriteRequest {
    path: string;
    content: string;
    encoding?: BufferEncoding;
  }

  export interface WriteResponse {
    bytesWritten: number;
  }

  export interface DownloadResponse {
    filePath: string;
  }

  /**
   * Save an attachment to a user-chosen location (monorepo#2458). `path` is
   * the daemon-side workspace-relative attachment path; the main process
   * owns the save dialog and fetches the bytes (local fs copy, or a
   * `file.readChunk` loop over a per-transfer connection on remote
   * backends).
   */
  export interface DownloadAttachmentRequest {
    workspaceId: WorkspaceId;
    path: string;
    /** Original attachment file name — the save dialog's default name. */
    fileName: string;
  }

  export interface DownloadAttachmentResponse {
    filePath: string;
  }
}

// ============================================================================
// Terminal IPC Contracts
// ============================================================================

export namespace TerminalIpc {
  export interface CreateRequest {
    workspaceId: WorkspaceId;
    cwd: string;
    shell?: string;
  }

  export interface CreateResponse {
    terminalId: string;
    pid: number;
  }

  export interface WriteRequest {
    terminalId: string;
    data: string;
  }
}

// ============================================================================
// IPC Contract Map
// ============================================================================

/**
 * Maps channel names to their request/response types
 * Enables type-safe invoke calls with full IntelliSense support
 */
export interface IpcContractMap {
  'workspaceDraft.create': [WorkspaceDraftIpc.CreateRequest, WorkspaceDraftIpc.CreateResponse];
  'workspaceDraft.get': [WorkspaceDraftIpc.GetRequest, WorkspaceDraftIpc.GetResponse];
  'workspaceDraft.list': [WorkspaceDraftIpc.ListRequest, WorkspaceDraftIpc.ListResponse];
  'workspaceDraft.update': [WorkspaceDraftIpc.UpdateRequest, WorkspaceDraftIpc.UpdateResponse];
  'workspaceDraft.promote': [WorkspaceDraftIpc.PromoteRequest, WorkspaceDraftIpc.PromoteResponse];
  'workspaceDraft.markDelivery': [
    WorkspaceDraftIpc.MarkDeliveryRequest,
    WorkspaceDraftIpc.MarkDeliveryResponse,
  ];
  'workspaceDraft.delete': [WorkspaceDraftIpc.DeleteRequest, WorkspaceDraftIpc.DeleteResponse];
  'agent:create': [AgentIpc.CreateRequest, AgentIpc.CreateResponse];
  'agent:get': [AgentIpc.GetRequest, AgentIpc.GetResponse];
  'agent:send-message': [AgentIpc.SendMessageRequest, AgentIpc.SendMessageResponse];
  'agent:list': [AgentIpc.ListRequest, AgentIpc.ListResponse];
  'agent:set-model': [AgentIpc.SetModelRequest, AgentIpc.SetModelResponse];
  'workspace:create': [WorkspaceIpc.CreateRequest, WorkspaceIpc.CreateResponse];
  'workspace:get': [WorkspaceIpc.GetRequest, WorkspaceIpc.GetResponse];
  'file:read': [FileIpc.ReadRequest, FileIpc.ReadResponse];
  'file:read-chunk': [FileIpc.ReadChunkRequest, FileIpc.ReadChunkResponse];
  'file:download-attachment': [
    FileIpc.DownloadAttachmentRequest,
    FileIpc.DownloadAttachmentResponse,
  ];
  'file:hash': [FileIpc.HashRequest, FileIpc.HashResponse];
  'file:write': [FileIpc.WriteRequest, FileIpc.WriteResponse];
  'terminal:create': [TerminalIpc.CreateRequest, TerminalIpc.CreateResponse];
  'terminal:write': [TerminalIpc.WriteRequest, void];
}
