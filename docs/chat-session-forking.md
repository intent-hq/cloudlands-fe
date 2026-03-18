# Chat Session Forking - Implementation Specification

## Product Context

### Use Case

Imagine you're in the middle of a conversation with an agent and realize you need to explore two separate threads with the same chat history, but going in different directions to solve prerequisite issues before the parent thread can move forward.

### User Flow

1. User is having a conversation about implementing feature X
2. Realizes they want to explore two different approaches in parallel
3. Clicks fork button (or uses `/fork` slash command)
4. System creates a new thread with deep cloned chat history
5. User continues in the forked thread exploring approach A
6. Can switch back to parent thread to explore approach B
7. Both threads maintain their own file changes and conversation history

### Goals

- Enable parallel exploration of different solution paths
- Maintain complete conversation context in each fork
- Keep forks independent (clean separation of file changes)
- Allow users to manage multiple conversation branches efficiently

---

## Design Decisions

### 1. Fork Metadata - Full Tracking

```typescript
interface AgentSession {
  // ... existing fields

  // Fork metadata
  parentSessionId?: SessionId; // ID of parent if this is a fork
  forkedAt?: string; // ISO timestamp of fork
  forkPoint?: number; // Message index where fork occurred
  childSessionIds?: SessionId[]; // IDs of child forks
}
```

**Rationale**: Bidirectional tracking enables future features (merge, visualization) without requiring data migration.

---

### 2. Fork Point - Current State Only

- User clicks fork button → clones entire message history up to now
- One-click operation, no message selection UI needed
- `forkPoint` will equal `messages.length` at fork time

**Rationale**: Simpler MVP. Fork-at-specific-message can be added later without breaking changes.

---

### 3. File Changes - Clean Slate

- Forked session starts with empty `fileChanges: []`
- Each fork tracks its own changes independently
- Parent can potentially absorb child's changes later (future feature)

**Rationale**: Cleaner separation of concerns. Easier to reason about what each fork has done.

---

### 4. Context Preservation - Minimal

Capture at fork time:

- ✅ **Selected text** (if any) - pass as context to first message
- ✅ **Model selection** - preserve in fork metadata
- ❌ **Current file/note** - dynamic, handled by normal context system
- ❌ **Scroll position** - not needed

```typescript
interface ForkMetadata {
  selectedText?: string;
  selectedModel?: string;
}
```

**Rationale**: Capture only what's useful for continuing the conversation. File/note context is already handled dynamically.

---

### 5. Fork Limits - None

- No maximum fork depth
- No maximum children per parent
- Trust the user to manage their own fork trees

**Rationale**: Don't add artificial constraints. If it becomes a problem, we can add limits later.

---

### 6. Fork Naming - Auto-generate

- Silent fork with auto-generated name: `"{parent name} (Fork)"`
- If multiple forks: `"{parent name} (Fork 2)"`, `"{parent name} (Fork 3)"`, etc.
- User can rename via existing rename functionality

**Rationale**: Fastest UX. Don't interrupt flow with dialogs.

---

### 7. Fork Visibility - Metadata Only (MVP)

- Store fork relationships in session metadata
- UI components to be added in Phase 2
- Can add badges, tree views, etc. later

**Rationale**: Focus on core functionality first. UI polish is iterative.

---

### 8. Backend Provider - New Session

- Create new backend agent via `agent:backend:create`
- Pass cloned messages as initial context
- Auggie will assign new `sessionId` (separate from our session `id`)

**Rationale**: Auggie doesn't support session resumption. This is the only viable approach.

**Note**: Unsatisfying but necessary given current provider limitations.

---

## Implementation Plan

### Phase 1: Data Layer & Core Logic

#### 1.1 Update Types (`src/shared/types.ts`)

```typescript
export interface AgentSession {
  // ... existing fields

  // Fork metadata
  parentSessionId?: SessionId;
  forkedAt?: string;
  forkPoint?: number;
  childSessionIds?: SessionId[];

  // Fork context
  forkMetadata?: {
    selectedText?: string;
    selectedModel?: string;
  };
}
```

#### 1.2 Add Fork Method (`src/features/agent/agent.service.ts`)

> Transitional note: Per `docs/STATE_MANAGEMENT.md`, store-based shared-state patterns shown here are transitional; new shared state should use Redux slices in `src/lib/store/`.

```typescript
async forkSession(
  sessionId: string,
  options?: {
    selectedText?: string;
    selectedModel?: string;
  }
): Promise<AgentSession | null> {
  // 1. Get source session
  const state = get(this.store);
  const sourceSession = state.sessions.get(sessionId);
  if (!sourceSession) return null;

  // 2. Deep clone messages
  const clonedMessages = JSON.parse(JSON.stringify(sourceSession.messages));

  // 3. Generate new session ID
  const newSessionId = crypto.randomUUID();

  // 4. Generate fork name
  const forkName = this.generateForkName(sourceSession);

  // 5. Create new session object
  const now = new Date();
  const forkedSession: AgentSession = {
    id: newSessionId,
    sessionId: null, // Will be set by backend
    workspaceId: sourceSession.workspaceId,
    messages: clonedMessages,
    name: forkName,
    status: AgentStatus.Idle,
    isProcessing: false,
    createdAt: now,
    lastActivity: now,
    startedAt: now.toISOString(),
    currentTurnNumber: 0,
    fileChanges: [], // Clean slate

    // Fork metadata
    parentSessionId: sessionId,
    forkedAt: now.toISOString(),
    forkPoint: clonedMessages.length,
    childSessionIds: [],
    forkMetadata: {
      selectedText: options?.selectedText,
      selectedModel: options?.selectedModel,
    },
  };

  // 6. Update parent's childSessionIds
  sourceSession.childSessionIds = sourceSession.childSessionIds || [];
  sourceSession.childSessionIds.push(newSessionId);

  // 7. Add to store
  this.store.update((state) => {
    state.sessions.set(newSessionId, forkedSession);
    state.sessions.set(sessionId, sourceSession); // Update parent
    state.activeSessionId = newSessionId;
    return state;
  });

  // 8. Save both sessions to disk
  await this.saveSessionToDisk(forkedSession);
  await this.saveSessionToDisk(sourceSession);

  // 9. Emit event
  eventBus.emitEvent("agent:session-forked", {
    workspaceId: sourceSession.workspaceId,
    parentSessionId: sessionId,
    childSessionId: newSessionId,
    forkPoint: clonedMessages.length,
  });

  // 10. Track telemetry
  await observability.trackAgentForked({
    workspaceId: sourceSession.workspaceId,
    parentAgentId: sessionId,
    childAgentId: newSessionId,
    messageCount: clonedMessages.length,
    forkPoint: clonedMessages.length,
  });

  // 11. Navigate to forked session
  await navigateToAgent(newSessionId);

  return forkedSession;
}

private generateForkName(sourceSession: AgentSession): string {
  const baseName = sourceSession.name || "Chat";
  const state = get(this.store);

  // Count existing forks of this parent
  const existingForks = Array.from(state.sessions.values())
    .filter(s => s.parentSessionId === sourceSession.id);

  if (existingForks.length === 0) {
    return `${baseName} (Fork)`;
  } else {
    return `${baseName} (Fork ${existingForks.length + 1})`;
  }
}
```

---

### Phase 2: Event System

#### 2.1 Update Event Bus (`src/shared/event-bus.ts`)

```typescript
export type DomainEvent =
  // ... existing events
  'agent:session-forked';

export interface EventPayloads {
  // ... existing payloads
  'agent:session-forked': {
    workspaceId: string;
    parentSessionId: string;
    childSessionId: string;
    forkPoint: number;
  };
}
```

#### 2.2 Update Workspace Events (`src/features/events/types.ts`)

```typescript
export type WorkspaceEventType =
  // ... existing types
  'agent:forked';

export interface AgentForkedEvent extends WorkspaceEventBase {
  type: 'agent:forked';
  data: {
    parentSessionId: string;
    childSessionId: string;
    forkPoint: number;
    messageCount: number;
  };
}

export type WorkspaceEvent =
  // ... existing events
  AgentForkedEvent;
```

---

### Phase 3: Observability

#### 3.1 Add Tracking Method (`src/features/observability/observability-service.ts`)

```typescript
async trackAgentForked(params: {
  workspaceId: string;
  parentAgentId: string;
  childAgentId: string;
  messageCount: number;
  forkPoint: number;
}): Promise<void> {
  await eventCollector.collect({
    type: AgentEventType.AGENT_FORKED,
    agentId: params.childAgentId,
    workspaceId: params.workspaceId,
    actor: { type: "user", id: "user" },
    data: {
      parentAgentId: params.parentAgentId,
      messageCount: params.messageCount,
      forkPoint: params.forkPoint,
    },
  });
}
```

#### 3.2 Add Event Type (`src/features/observability/event-collector.ts`)

```typescript
export enum AgentEventType {
  // ... existing types
  AGENT_FORKED = 'agent:forked',
}
```

---

### Phase 4: UI Components

**Components to add:**

1. **Fork button** in `src/lib/components/layout/ContentDrawer.svelte`
   - Add to header toolbar
   - Icon: `faCodeBranch` from FontAwesome
   - Disabled when `isStreaming === true`

2. **Slash command** in `src/lib/components/chat/input/SimpleRichInput.svelte`
   - Add `/fork` command handler
   - Trigger same `forkSession()` method

3. **Fork indicators** (optional, future):
   - Badge in `src/lib/components/chat/AgentsList.svelte`
   - "Forked from X" banner in `src/lib/components/chat/AuggieChatPanel.svelte`
   - "Back to parent" button in drawer header

---

## Data Flow

```
User triggers fork (button/command/API)
    ↓
AgentService.forkSession(sessionId, options)
    ↓
1. Get source session from store
2. Deep clone messages: JSON.parse(JSON.stringify())
3. Generate new ID: crypto.randomUUID()
4. Generate fork name: "{parent} (Fork N)"
5. Create new session with:
   - Cloned messages
   - New ID
   - Fork metadata (parent, timestamp, point)
   - Clean fileChanges: []
   - Fork context (selectedText, model)
6. Update parent.childSessionIds.push(newId)
7. Add both to store
8. Save both to disk
9. Emit "agent:session-forked" event
10. Track via observability.trackAgentForked()
11. Navigate to new session
    ↓
Backend creates new provider instance (lazy)
    ↓
UI shows forked session
```

---

## Testing Strategy

### Unit Tests

- `forkSession()` creates valid session with correct metadata
- Fork name generation handles multiple forks correctly
- Parent's `childSessionIds` is updated
- Messages are deep cloned (not referenced)

### Integration Tests

- Fork + save + restore from disk preserves all metadata
- Fork + navigate updates URL correctly
- Events are emitted and received

### E2E Tests

- User can fork session and continue conversation
- Multiple forks of same parent work correctly
- Fork metadata persists across app restarts

---

## Open Questions / Future Work

1. **Merge functionality**: How would parent absorb child's changes?
2. **Fork visualization**: Tree view, graph view, or timeline?
3. **Fork at message**: UI for selecting fork point?
4. **Fork cleanup**: Archive old/unused forks automatically?
5. **Provider resumption**: If Auggie adds support, how to migrate?

---

## Success Criteria

✅ User can fork a session with one action
✅ Forked session has complete message history
✅ Forked session tracks its own file changes
✅ Parent knows about its children (bidirectional)
✅ Fork metadata persists across restarts
✅ Events are emitted for observability
✅ UI components enable forking workflow
