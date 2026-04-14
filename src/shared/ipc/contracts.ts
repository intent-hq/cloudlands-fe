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
import type { AgentId, SessionId, WorkspaceId, MessageId } from '../types/branded-ids';
import type { AgentSession } from '../types';

// ============================================================================
// Base IPC Types
// ============================================================================

/**
 * Base request type for all IPC calls
 */
export interface IpcRequest<T = any> {
  id: string;
  timestamp: number;
  payload: T;
}

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
   * Backend builds system prompt from agentType via InstructionService.
   */
  export interface CreateRequest {
    workspaceId: WorkspaceId;
    workspacePath: string;
    name: string;
    agentId?: AgentId; // Optional: if provided, backend will use this ID instead of generating a new one
    model?: string;
    provider?: string; // Provider ID (e.g., 'auggie', 'claude-code', 'codex') - uses activeProviderStore.activeProviderId
    agentType?: string; // Agent type for specialization rules (debug, investigate, implement, etc.)
    behaviorPrompt?: string; // Custom behavior instructions for the agent (from specialist)
    systemPrompt?: string; // DEPRECATED: Kept for IPC backward compat, but IGNORED by backend
    rules?: string; // DEPRECATED: Kept for IPC backward compat, but IGNORED by backend
    initialMessage?: string;
    contextReferences?: any[];
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
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

  export interface StreamChunkData {
    /** Typed as AgentId because agentId === sessionId in this architecture */
    sessionId: AgentId;
    chunk: string;
    sequenceNumber: number;
    isComplete: boolean;
  }

  export interface ListRequest {
    workspaceId: WorkspaceId;
    includeDeleted?: boolean;
  }

  export interface ListResponse {
    agents: AgentSession[];
  }

  export interface DeleteRequest {
    agentId: AgentId;
    workspaceId: WorkspaceId;
  }

  export interface DeleteResponse {
    success: boolean;
  }

  export interface StopRequest {
    agentId: AgentId;
  }

  export interface StopResponse {
    success: boolean;
  }

  export interface SaveRequest {
    agentId: AgentId;
    workspaceId: WorkspaceId;
  }

  export interface SaveResponse {
    success: boolean;
  }

  export interface LoadRequest {
    agentId: AgentId;
    workspaceId: WorkspaceId;
  }

  export interface LoadResponse {
    agent?: AgentSession;
    success: boolean;
  }

  export interface ListSavedRequest {
    workspaceId: WorkspaceId;
  }

  export interface ListSavedResponse {
    agents: AgentSession[];
  }

  export interface ActivateRequest {
    agentId: AgentId;
    workspaceId?: WorkspaceId; // Optional for backward compatibility
    sessionId?: SessionId; // Optional for session tracking
  }

  export interface ActivateResponse {
    success: boolean;
    backendSessionId?: string;
    agent?: AgentSession; // The full activated agent session
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

  export interface WriteRequest {
    path: string;
    content: string;
    encoding?: BufferEncoding;
  }

  export interface WriteResponse {
    bytesWritten: number;
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
  'agent:create': [AgentIpc.CreateRequest, AgentIpc.CreateResponse];
  'agent:get': [AgentIpc.GetRequest, AgentIpc.GetResponse];
  'agent:send-message': [AgentIpc.SendMessageRequest, AgentIpc.SendMessageResponse];
  'agent:list': [AgentIpc.ListRequest, AgentIpc.ListResponse];
  'workspace:create': [WorkspaceIpc.CreateRequest, WorkspaceIpc.CreateResponse];
  'workspace:get': [WorkspaceIpc.GetRequest, WorkspaceIpc.GetResponse];
  'file:read': [FileIpc.ReadRequest, FileIpc.ReadResponse];
  'file:write': [FileIpc.WriteRequest, FileIpc.WriteResponse];
  'terminal:create': [TerminalIpc.CreateRequest, TerminalIpc.CreateResponse];
  'terminal:write': [TerminalIpc.WriteRequest, void];
}
