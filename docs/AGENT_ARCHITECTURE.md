# Agent System Architecture

> **Version**: 2.5.0
> **Last Updated**: January 21, 2026
> **Status**: Production

## Overview

The agent system provides AI-powered assistance within workspaces. It handles agent creation, message streaming, queueing, interruption, and persistence through a clean, layered architecture.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RENDERER PROCESS                               │
├─────────────────────────────────────────────────────────────────────────┤
│  UI Components                                                           │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐        │
│  │ WorkspaceInit    │ │ AgentLaunchMenu  │ │ ContextualMenu   │        │
│  │ ChatPanel        │ │ BubbleMenu       │ │ BackgroundAgent  │        │
│  └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘        │
│           │                    │                    │                   │
│           └────────────────────┼────────────────────┘                   │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    UnifiedAgentFactory                           │   │
│  │  • Single entry point for ALL agent creation                     │   │
│  │  • Validates config, generates IDs                               │   │
│  │  • Calls backend via IPC                                         │   │
│  └─────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                    │
│  ┌─────────────────────────────────┼───────────────────────────────┐   │
│  │                    AgentService                                  │   │
│  │  • Session management                                            │   │
│  │  • Message sending                                               │   │
│  │  • Stream handling                                               │   │
│  └─────────────────────────────────┬───────────────────────────────┘   │
│                                    │ IPC                                │
├────────────────────────────────────┼────────────────────────────────────┤
│                           MAIN PROCESS                                   │
├────────────────────────────────────┼────────────────────────────────────┤
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  AgentBackendHandler                             │   │
│  │  • IPC request handling                                          │   │
│  │  • Message queueing (messageQueues Map)                          │   │
│  │  • Interruption handling (interruptedAgents Set)                 │   │
│  │  • Stream coordination                                           │   │
│  └─────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                    │
│  ┌─────────────────────────────────┼───────────────────────────────┐   │
│  │               ConsolidatedBackendService                         │   │
│  │  • Agent lifecycle management                                    │   │
│  │  • ACP session creation                                          │   │
│  │  • Health monitoring                                             │   │
│  └─────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                    │
│  ┌─────────────────────────────────┼───────────────────────────────┐   │
│  │                  InstructionService                              │   │
│  │  • 9-layer system prompt building                                │   │
│  │  • 3-tier rule fallback                                          │   │
│  │  • Mode behavior prompts                                         │   │
│  └─────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     ACP Provider                                 │   │
│  │  • Auggie communication                                          │   │
│  │  • Streaming responses                                           │   │
│  │  • Tool execution                                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. UnifiedAgentFactory (Frontend)

**Location**: `src/features/agent/services/agent-factory.ts`

The single entry point for ALL agent creation. Consolidates multiple creation methods into one clean interface.

```typescript
interface UnifiedAgentConfig {
  // Required
  workspaceId: BrandedWorkspaceId;

  // Optional - name is derived from initialMessage if not provided
  name?: string;
  id?: string; // Pre-generated agent ID
  model?: string;
  initialMessage?: string;
  contextReferences?: any[];
  metadata?: Record<string, any>;
  behaviorPrompt?: string; // Custom behavior instructions (from specialist)
  workspaceContext?: {
    // Open panels + linked references
    openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
    linkedReferences: Array<{ type: string; title: string; identifier?: string; url?: string }>;
  };

  // Source tracking
  source?:
    | 'workspace-initializer'
    | 'contextual-menu'
    | 'chat-panel'
    | 'api'
    | 'background-agent-trigger'
    | 'workspace-page'
    | 'agent-launch-menu'
    | 'bubble-menu'
    | 'specialist-picker'
    | string;
  agentType?: AgentTypeId; // Backend builds system prompt from this

  // NOTE: systemPrompt is DEPRECATED - backend builds from agentType via InstructionService
}

// Usage
const result = await agentFactory.createAgent(workspace, {
  name: 'My Agent',
  workspaceId: WorkspaceId(workspace.id),
  agentType: createAgentTypeId('chat'),
  source: 'workspace-sidebar',
});
```

**Key Responsibilities**:

- Validate configuration
- Generate agent IDs using `unifiedIdService`
- Call backend via IPC
- Handle retry logic for duplicate agents

### 2. AgentBackendHandler (Backend)

**Location**: `src/features/agent/main/agent-backend-handler.service.ts`

Handles all IPC requests from the frontend and orchestrates backend operations.

**Key Data Structures**:

```typescript
private messageQueues = new Map<string, QueuedMessage[]>();
private processingQueue = new Set<string>();
private interruptedAgents = new Set<string>();
```

**Key Methods**:

- `handleCreateAgent()` - Create new agent
- `handleSendMessage()` - Send message to agent
- `handleStopSession()` - Stop agent and mark as interrupted
- `handleQueueMessage()` - Queue message for later processing
- `processNextQueuedMessage()` - Process queued messages (skips interrupted agents)

### 3. InstructionService (Backend)

**Location**: `src/features/agent/main/instruction-service.ts`

Builds system prompts using a **9-layer** architecture. The order is:

1. **Base System Prompt** - Core identity and tool guidance for all interactive agents
2. **Specialization Rules** - `common` → `workspace` → agent-specific instructions
3. **User Rules** - `CLAUDE.md`, `AGENTS.md`, `.augment/guidelines.md`, `.augment/rules/`
4. **Skills Catalog** - Skills discovered from `.agents/skills`, `.augment/skills`, and `~/.claude/skills`
5. **Agent Behavior Instructions** - Specialist behavior prompt supplied at launch time
6. **Parent-Only Orchestration Layers** - Team context, global knobs, specialists, and branch naming
7. **Workspace Context** - Open panels + linked references
8. **Runtime Context** - `contextReferences`
9. **Mandatory Actions Footer** - End-of-prompt role reminder / required footer actions

The mandatory footer remains at the end, and sub-agents skip the parent-only orchestration layers plus workspace context.

**3-Tier Rule Fallback** (for specialization rules):

1. User customizations (EndUserRulesManager via electron-store)
2. Workspace files (.augment/agent-rules/{type}.md)
3. Bundled defaults (TypeScript constants in instructions/ directory)

**Prompt assembly inputs**:

- Public `buildSystemPrompt()` config fields: `agentType`, `workspacePath`, `contextReferences`, `behaviorPrompt`, `specialistName`, `roleReminder`, `workspaceContext`, `workspaceTitle`, `isInitialAgent`, `isSubAgent`
- Internal caching inputs: `prefetchedSkillsCatalog` (internal prefetch used when building cache keys)

### 4. ConsolidatedBackendService (Backend)

**Location**: `src/features/agent/main/consolidated-backend.service.ts`

Single source of truth for agent operations. Manages:

- Agent sessions
- ACP provider connections
- Health monitoring
- Persistence

## Agent Lifecycle

### Creation Flow

```
1. UI Component calls agentFactory.createAgent(workspace, config)
2. UnifiedAgentFactory validates config, generates IDs
3. IPC call to backend: AGENT_CHANNELS.CREATE
4. AgentBackendHandler.handleCreateAgent()
5. ConsolidatedBackendService.createAgent()
6. InstructionService builds system prompt from agentType
7. ACP Provider creates session with Auggie
8. Agent saved to disk
9. Response returned to frontend
```

### Resumption Flow

```
1. UI calls agentIpcProxy.activateAgent(agentId, workspace)
2. IPC call to backend: AGENT_CHANNELS.ACTIVATE
3. AgentBackendHandler.getAgentResumability() checks agent state:
   - 'running': Provider exists and process is alive
   - 'resumable': No provider but data exists on disk
   - 'not_found': No provider and no persisted data
4. If resumable, AgentBackendHandler.resumeAgent() restores from disk
5. ConsolidatedBackendService creates new ACP session
6. Agent returned with backendSessionId
```

### Backend-Initiated Messages

When the backend needs to send a message (e.g., wake handler, system events):

```
1. AgentBackendHandler.sendBackendInitiatedMessage() called
2. Check if provider exists for agent
3. If no provider:
   a. Load agent from persistence
   b. Request frontend handler via requestFrontendHandler()
   c. Wait for 'agent:handler-ready' signal from frontend
   d. Emit 'agent:created' with wake message included
   e. Resume session in backend memory
4. Send message via handleBackendStreamMessage()
```

This handshake ensures stream handlers are registered before streaming begins.

### Session Recovery (Page Refresh/HMR)

Session recovery is split between a thin renderer stream adapter and Redux sagas. `src/features/agent/agent-stream-lifecycle.ts` reconnects stream handlers and emits typed Redux actions; state-dependent decisions and side-effect orchestration live in `src/store/renderer/slices/agent-session/sagas/agent-stream-saga.ts`.

**On initialization** (`reconnectActiveStreams()`):

1. Scans all sessions in store for messages with `isStreaming === true`
2. Re-registers stream handlers for those sessions
3. This allows continuing to receive chunks from ongoing backend streams

**Backend stream query** (`reconnectToBackendStreams()`):

1. Calls `agent:get-active-streams` IPC to query active backend streams
2. Dispatches `backendStreamsReconnectResultReceived(...)` with the raw backend snapshot
3. Lets agent-session stream sagas clear stale streaming state, refresh stale sessions, and reconcile active streams
4. Re-registers IPC handlers and marks sessions as streaming where appropriate
5. Reconciles Redux-owned agent-session and chat lifecycle state for restored streams

**Cross-workspace streaming**:

- Uses `getAllSessionsAcrossWorkspaces()` to check ALL workspaces
- `setStreamingForWorkspace()` updates state in non-current workspaces
- Backend tracks `streamWorkspaceIds` Map for each active stream
- Stream completion correctly updates session even if user switched workspaces

**SessionStorage persistence**:

- Active streams saved to sessionStorage on page unload (`beforeunload` handler)
- Restored via `restoreFromSessionStorage()` on next load
- Restored sessions marked as `degraded` until verified

**Thin service rule**: service and lifecycle files should remain as thin as possible. They may subscribe to IPC/stream events and dispatch typed Redux actions, but Redux-state target lookup, stale-session refresh/reconcile, rate limiting, fallback assistant message creation policy, and other side-effect orchestration belong in Redux sagas. See [Agent Message Deduplication and Stream Saga Architecture](./agent-message-dedup-and-stream-sagas.md).

### Message Flow

```
1. UI sends message request through the current Redux/IPC message flow
2. IPC call to backend: AGENT_BACKEND_CHANNELS.SEND_MESSAGE
3. AgentBackendHandler.handleSendMessage()
4. If agent busy → queue message
5. ACP Provider sends to Auggie
6. Streaming response via session-specific channel
7. ContentBlocks accumulated and persisted
```

## Streaming Architecture

### StreamManager

**Location**: `src/features/agent/services/stream-manager.ts`

The StreamManager uses **agentId as the canonical key** for all sessions. Since only ONE stream per agent is allowed at a time (enforced by `cleanupSessionByAgentId` at the start of `startStream`), we use agentId directly as the session key. This eliminates the need for complex ID mapping between streamId, sessionId, frontendSessionId, and backendSessionId.

Key features:

- Direct pass-through streaming (no batching, no buffering, no delays)
- Session management with automatic cleanup
- Health monitoring and recovery
- Memory leak prevention

### Stream Health Monitoring

The StreamManager monitors stream health with the following configuration:

```typescript
// Health check configuration
STALLED_TIMEOUT: 30000,                 // 30 seconds - stream considered stalled
TIMEOUT: 10000,                         // 10 seconds - stalled stream cleanup threshold
RECOVERY_TIMEOUT: 5000,                 // 5 seconds for recovery attempts
CLEANUP_INTERVAL: 60 * 60 * 1000,       // 1 hour (shared completion-detection window)
SESSION_TIMEOUT: 30 * 60 * 1000,        // 30 minutes
HEALTH_CHECK_INTERVAL: 30000,           // 30 seconds between health checks

// Memory limits (to prevent GC pressure)
MAX_SESSIONS: 10,
MAX_CHUNK_SIZE: 256 * 1024,         // 256KB per chunk
MAX_CHUNKS_BEFORE_PRUNE: 200,       // Start pruning at 200 chunks
MAX_CHUNKS_AFTER_PRUNE: 50,         // Keep only 50 chunks after pruning
MAX_SESSION_BYTES: 10 * 1024 * 1024, // 10MB max per session
MEMORY_LEAK_THRESHOLD: 20 * 1024 * 1024 // 20MB
```

**Health Statuses**:

- `healthy` - Active within timeout, normal operation
- `degraded` - No activity for half of STALLED_TIMEOUT
- `stalled` - No activity for full STALLED_TIMEOUT, recovery attempted
- `error` - Recovery failed and the stream was terminated
- `recovering` - Currently attempting recovery

### Stream Channels

- **Session-specific**: `agent:stream:{sessionId}` - Modern approach
- **Legacy**: `agent:message:chunk` - Deprecated, no longer emitted

### Stream Events

```typescript
type StreamEventType =
  | 'chunk' // Text chunk
  | 'content-blocks' // ContentBlock array
  | 'complete' // Stream finished
  | 'error' // Stream error
  | 'end'; // Final cleanup
```

### ContentBlocks

All messages use ContentBlocks for unified structure:

```typescript
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; code: string; language?: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: any }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'audio'; source: AudioSource };
```

### Message Deduplication and Missing-Target Reconciliation

Agent session message deduplication is centralized in `src/shared/utils/message-dedup.ts` and applied by `src/store/renderer/slices/agent-session/agent-session-slice.ts` during session/message ingestion. The shared utility owns duplicate matching and merge policy for assistant stream finalization cases, including near-duplicate content with divergent renderer/backend identities, so renderer and main-process persistence paths use the same rules.

When stream updates arrive without a local assistant update target, `agent-stream-lifecycle.ts` dispatches raw stream actions and the agent-session `agent-stream-saga.ts` performs the stateful reconciliation: select the session, try canonical target matching, refresh from persistence with bypass cache, and only then create a fallback assistant message if needed. See [Agent Message Deduplication and Stream Saga Architecture](./agent-message-dedup-and-stream-sagas.md) for the full flow.

## Queueing & Interruption

### Message Queueing

When an agent is busy processing, new messages are queued:

```typescript
interface QueuedMessage {
  /** Unique identifier for this queued message */
  id: string;
  /** The message content */
  content: string;
  /** When the message was queued (ISO string) */
  queuedAt: string;
  /** Optional context items attached to the message */
  contextItems?: QueuedMessageContextItem[];
  /** Optional image blocks attached to the message */
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  /** Position in queue (0 = next to be sent) */
  position: number;
}
```

**Queue Operations (AgentBackendHandler)**:

- `handleQueueMessage()` - Add message to queue
- `handleEditQueuedMessage()` - Edit content of queued message
- `handleRemoveQueuedMessage()` - Remove message from queue
- `handleGetQueue()` - Get current queue for an agent
- `processNextQueuedMessage()` - Auto-process after stream completes

**Stale Message Handling**: Queue processing warns about messages older than 1 hour but still sends them.

### Interruption Handling

When `handleStopSession()` is called:

1. Agent ID added to `interruptedAgents` Set
2. ACP Provider interrupted via `provider.interrupt()`
3. Backend cleanup via `backend.backendStop()`
4. 'complete' event sent to frontend (not 'error' - interruption is expected behavior)
5. `processNextQueuedMessage()` checks `interruptedAgents` and skips processing
6. Agent ID removed from `interruptedAgents` after skip

This prevents queued messages from auto-sending after user stops an agent.

**Error vs Interruption Behavior**:

- **Interruptions**: Send 'complete' event, agent not marked as failed
- **Real Errors**: Send 'error' event, agent marked as failed, `agent:failed` event emitted

## Edit & Regenerate Flow

The ChatService provides methods to edit user messages and regenerate responses:

### editAndRegenerate

**Location**: `src/features/agent/services/chat.service.ts`

Edits a user message and regenerates from that point:

```
1. Find the message to edit
2. If streaming in progress → stopChat() first
3. Re-fetch state after stop (messages may have changed)
4. Re-find message index (CRITICAL: use updated index)
5. Truncate messages to before the edited message
6. Update BOTH ChatService state AND sessionStore
7. Send new message with resetHistory=true flag
```

### regenerateFromMessage

Regenerates a response from a specific assistant message:

```
1. If streaming in progress → stopChat() first
2. Re-fetch state after stop
3. Find the assistant message
4. Find the preceding user message
5. Truncate messages to before the user message
6. Update BOTH ChatService state AND sessionStore
7. Resend user message with resetHistory=true flag
```

### resetHistory Flag

When `resetHistory=true` is passed to `sendMessage()`:

1. Backend calls `provider.resetSession()` on the ACP Provider
2. ACP Provider creates a NEW ACP session (clears internal history)
3. `sessionWasRecreated` flag is set to true
4. Next message includes full conversation history in the prompt

**Optimization**: If `sessionWasRecreated` is already true (e.g., from a recent interrupt), `resetSession()` skips creating another session to prevent race conditions.

### Critical Implementation Details

1. **Dual State Update**: Both chat state and persisted agent-session state must be updated when truncating messages. Otherwise, stale persistence can restore truncated messages.

2. **Index Refresh**: After `stopChat()`, the message list may change. The message index must be re-calculated using the updated state.

3. **Session Reset**: The ACP session must be reset so the agent only sees the truncated history, not the full original conversation.

## Agent Types

Defined in `src/shared/types/agent.types.ts`:

```typescript
type AgentTypeId =
  | 'chat'
  | 'code-walkthrough'
  | 'common'
  | 'debug'
  | 'workspace'
  | 'setup-script-generator'
  | 'task-breakdown'
  | 'task-debug'
  | 'task-focused'
  | 'task-loop'
  | 'ralph-loop'
  | 'workspace-agent'
  | 'code-review'
  | 'commit-message'
  | 'pr-description';
```

Most typed IDs have corresponding instruction sources in `src/features/agent/main/instructions/`; `common` is the shared instruction layer that gets prepended during specialization assembly.

## Background Agents

Background agents run automated tasks without user interaction. They are created with `isBackground: true` metadata and are filtered out from the main agent list.

### BackgroundAgentExecutor

**Location**: `src/features/agent/background-agent-executor.svelte.ts`

A reactive utility for executing background agents with real-time status tracking:

```typescript
const executor = new BackgroundAgentExecutor({
  type: 'commit',
  resultTag: 'COMMIT_MESSAGE',
  timeout: 60000,
  onResult: (result) => {
    commitMessage = result;
  },
});

// Execute the agent
await executor.execute(workspace, context);

// Access reactive state (Svelte 5 runes)
executor.status; // 'idle' | 'initializing' | 'running' | 'success' | 'error' | 'cancelled'
executor.messages; // Array of messages
executor.result; // Extracted result
executor.progress; // 0-100
```

### Background Agent Types

| Trigger Type  | Instruction ID     | Result Tag         | Timeout | Purpose                  |
| ------------- | ------------------ | ------------------ | ------- | ------------------------ |
| `commit`      | `commit-message`   | `COMMIT_MESSAGE`   | 120s    | Generate commit messages |
| `pr`          | `pr-description`   | `PR_DESCRIPTION`   | 180s    | Generate PR descriptions |
| `review`      | `code-review`      | `CODE_REVIEW`      | 120s    | Code review analysis     |
| `walkthrough` | `code-walkthrough` | `CODE_WALKTHROUGH` | 120s    | Code walkthrough         |

### Factory Functions

```typescript
import {
  createCommitMessageExecutor,
  createPRDescriptionExecutor,
  createCodeReviewExecutor,
  createWalkthroughExecutor,
} from './background-agent-executor.svelte';

const executor = createCommitMessageExecutor({
  onResult: (result) => console.log(result),
});
```

### Background Agent Settings

Model selection for background agents is configurable per-type via `backgroundAgentSettingsStore`:

```typescript
import { backgroundAgentSettingsStore } from '$store/renderers/background-agent-settings.store.svelte';

// Get model for specific type
const model = backgroundAgentSettingsStore.getModelForType('commit');
```

### Reconnection Support

Background agents support reconnection to running agents:

```typescript
// Reconnect to an existing agent
const result = await executor.reconnect(agentId, workspaceId);

// If agent is still running, executor subscribes to updates
// If agent finished, result is extracted from existing messages
```

## Agent Modes

Using ACP's native session modes:

- **ask** - Question answering, no tool use
- **plan** - Planning mode (default for new workspace agents)
- **agent** - Full agent mode with tools (default for other agents)

## Entry Points

All agent creation goes through `agentFactory.createAgent()`:

| Component            | Source                  | Notes                   |
| -------------------- | ----------------------- | ----------------------- |
| WorkspaceInitializer | `workspace-initializer` | New workspace agents    |
| AgentLaunchMenu      | `agent-launch-menu`     | Contextual agent launch |
| ContextualMenu       | `contextual-menu`       | Right-click menu        |
| ChatPanel            | `chat-panel`            | Chat interface          |
| BubbleMenu           | `bubble-menu`           | Text selection menu     |
| TaskDelegation       | `task-menu`             | Task assignment         |
| MCP Tools            | `mcp-tool`              | Agent-spawned agents    |

## Persistence

Agents are persisted to disk at:

```
~/.workspaces/{workspaceId}/.workspace/agents/{agentId}.json
```

Persistence is handled by `AgentPersistence` service in the main process.

## Error Handling

Uses unified error handler from `services/error-handler.ts`:

```typescript
const error = new AgentError(message, {
  code: ErrorCode.MESSAGE_SEND_FAILED,
  category: ErrorCategory.COMMUNICATION,
  severity: ErrorSeverity.HIGH,
  context: { agentId, originalError },
});
errorHandler.track(error);
```

## Agent Operability Verification Gates

Future changes to delegation, subscriptions, diagnostics, wake/resume, or
programmatic agent testing must run the focused agent-operability gate before
handoff:

```bash
pnpm run verify:agent-operability
```

The grouped gate expands to the required focused suites, architecture/state
checks, broad Svelte/TypeScript checks, and diff whitespace validation:

```bash
pnpm run test:agent-operability
pnpm run lint:agent-architecture
pnpm run check
pnpm tsc -p tsconfig.json --noEmit
pnpm tsc -p tsconfig.main.json --noEmit
pnpm tsc -p tsconfig.preload.json --noEmit
git diff --check
```

Run `pnpm run test:agent-operability:stress` when iterating only on the bounded
stress/chaos runner. Longer stress runs remain opt-in through the stress test's
documented environment variables; do not make unbounded stress mandatory in the
default gate.

### Focused Coverage Map

`pnpm run test:agent-operability` covers these agent-state risk areas:

- Provider: provider registry and `programmatic-test-agent-provider.test.ts`.
- Subscription state: selectors, reducers, and `agent-subscriptions-saga.test.ts`.
- Diagnostics and MCP tools: `agent-interaction-tools.test.ts`.
- Orchestration: `agent-interaction-tools.test.ts` plus
  `agent-interaction-integration.test.ts`.
- Wake/resume: wake/create paths in `agent-interaction-tools.test.ts` and backend
  lifecycle event emission tests.
- Stress/chaos: `reliability-stress-runner.test.ts`.
- UI duplicate-message risk: shared `message-dedup.test.ts`.

`pnpm run lint:agent-architecture` is the architecture/state-integrity gate used
in place of a historical `validate:architecture` script. It runs workspace event
dispatcher checks for agent/MCP/subscription paths, saga selector hygiene, Redux
saga adapter bypass, and type-contract validation checks for the main-process
agent-subscription state path. Main subscription state integrity is also covered
by the focused subscription selector, reducer, and saga tests in
`pnpm run test:agent-operability`. Broader renderer rollout gates, such as
`pnpm run lint:selector-active-workspace` and `pnpm run lint:redux-collections`,
remain separate from this focused agent-operability gate.

### Final Handoff / PR Packaging Gate

Before final handoff or PR creation, run `git status --short` and ensure all Wave
agent-operability files are tracked/included. In particular,
`src/features/agent/testing/programmatic-test-agent-provider.test.ts` is required
coverage and must not be left untracked or omitted from packaging.

### In-App Dogfood Gate

Automated checks are necessary but not sufficient. The final verifier should also
dogfood the app-facing workspace agent APIs and record the exact calls, observed
diagnostics, and pass/fail results:

1. Create/delegate deterministic programmatic-provider agents for `immediate` and
   `after_all` flows.
2. Exercise `ws.agent.send`, `ws.agent.sendToTask`, and `ws.agent.wakeOrCreate`
   for existing, resumable, busy/queued, and fallback-create agents.
3. Capture sanitized `ws.agent.diagnostics(...)` snapshots before, during, and
   after delivery to confirm subscriptions, queues, delegation groups, delivery
   stats, and stuck-risk signals self-heal.
4. Verify no duplicate app-facing messages or duplicate delegator wake
   notifications appear during retries, sweep/catch-up, group completion, or
   queued-message lifecycle events.
5. Re-run `pnpm run verify:agent-operability` after any dogfood-driven fix.

## Testing

Tests are located in:

- `services/__tests__/` - Unit tests
- `tests/integration/` - Integration tests

Run tests:

```bash
pnpm run test:unit -- --reporter=default
```

## Related Documentation

- [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) - Getting started
- [STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md) - State management patterns
- [ERROR_HANDLING_SYSTEM.md](./ERROR_HANDLING_SYSTEM.md) - Error handling
- [TYPE_SYSTEM_GUIDE.md](./TYPE_SYSTEM_GUIDE.md) - Type safety
