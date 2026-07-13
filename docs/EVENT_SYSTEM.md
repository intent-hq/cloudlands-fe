# Event System Architecture

**Version**: 3.0
**Date**: 2026-03-25
**Purpose**: Comprehensive guide to the Redux-based event system

## Overview

The Intent app uses a **Redux-based event system** for all workspace events. Events are managed through Redux slices and sagas in the main process, with IPC channels for renderer communication.

1. **WorkspaceEvents**: Full-featured events managed by `workspace-events` Redux slice with persistence, filtering, and query support
2. **DomainEvents**: Broadcast events managed by `domain-events` Redux actions and sagas

> **Note**: The legacy EventBus singletons (UnifiedEventBus, WorkspaceEventBus, WorkspaceEventService) have been removed. All event state is now managed through Redux.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Renderer Process                             │
├─────────────────────────────────────────────────────────────────┤
│  Components              Redux Store              Selectors     │
│  ┌─────────┐         ┌──────────────────┐    ┌─────────────┐   │
│  │ UI      │◄────────│ workspace-events │◄───│ Reactive    │   │
│  │ Layer   │────────►│ slice (synced)   │───►│ Selectors   │   │
│  └─────────┘         └────────┬─────────┘    └─────────────┘   │
└──────────────────────────────┼──────────────────────────────────┘
                               │ IPC (Redux sync)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Main Process                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Redux Store (Main)                          │    │
│  │                                                          │    │
│  │  • workspace-events slice — event state + persistence   │    │
│  │  • domain-events actions — broadcast events             │    │
│  │  • agent-subscriptions slice — agent event filters      │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│           ┌───────────────┼───────────────┐                     │
│           ▼               ▼               ▼                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ EventStore   │ │ QueryEngine  │ │ Sagas        │            │
│  │ (JSONL I/O)  │ │ (pure query) │ │ (side fx)    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Event Types

### WorkspaceEvents (Full Events)

Used for file changes, agent actions, git operations. Features:
- Unique ID and timestamp
- Actor attribution (user, agent, system)
- Workspace scoping
- Persistence to disk (via sagas + EventStore)
- Filterable queries (via EventQueryEngine)

```typescript
interface WorkspaceEvent {
  id: string;
  type: WorkspaceEventType;
  timestamp: string;
  workspaceId?: string;
  actor?: EventActor;
  data: Record<string, unknown>;
}
```

### DomainEvents (Simple Broadcast)

Used for terminal, notes, comments. Features:
- Redux actions dispatched via `domain-events-actions.ts`
- Broadcast saga sends to all renderer windows
- STDIO broadcasting for MCP

```typescript
// Emit a domain event via Redux
import { domainEventEmitted } from 'store/main/slices/domain-events/domain-events-actions';
mainDispatch(domainEventEmitted({ name: 'terminal:data', data: { terminalId, data } }));
```

## Key Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| workspace-events slice | `store/main/slices/workspace-events/` | Event state management |
| domain-events actions | `store/main/slices/domain-events/` | Broadcast event actions + sagas |
| agent-subscriptions slice | `store/main/slices/agent-subscriptions/` | Agent event filter state |
| EventStore | `features/events/main/event-store.ts` | Pure JSONL I/O (used by persistence saga) |
| EventQueryEngine | `features/events/main/event-query-engine.ts` | Pure query logic (used by IPC handler) |
| EventFilterEngine | `features/events/event-filter-engine.ts` | Pure filter matching logic |
| agent-event-tools | `features/events/main/agent-event-tools.ts` | MCP tool definitions |
| agent-subscription-ops | `features/events/main/agent-subscription-ops.ts` | Agent subscription operations |

## Emitting Events

```typescript
// Emit a workspace event via Redux
import { emitWorkspaceEvent } from 'store/main/slices/workspace-events/workspace-events-slice';
import { createWorkspaceEvent } from 'features/events/types';
import { mainDispatch } from 'store/main/redux-store-bridge';

mainDispatch(emitWorkspaceEvent(
  createWorkspaceEvent('file:changed', workspaceId, actor, data)
));
```

## IPC Channels

All event IPC channels are defined in `src/shared/ipc-registry.ts`:

| Channel | Purpose |
|---------|---------|
| `events:emit` | Emit event from renderer |
| `events:subscribe` | Subscribe to events |
| `events:unsubscribe` | Unsubscribe from events |
| `events:query` | Query events with filters |
| `events:getLastEvent` | Get last event of type |
| `events:getStatistics` | Get event statistics |

## Data Flow: File Change Event

```
1. File changed on disk
   ↓
2. ChangeDetector detects via FileWatcher/GitPolling
   ↓
3. ChangeProcessor creates WorkspaceEvent
   ↓
4. EventCoordinator emits 'activity-log-event'
   ↓
5. ChangeDetectorRefactored forwards → ChangeDetectorManager forwards →
   workspace.ipc.ts listener dispatches mainDispatch(emitWorkspaceEvent())
   ↓
6. workspace-events slice accepts event (with deduplication)
   ├── Persistence saga writes to EventStore (JSONL)
   ├── Renderer subscription saga delivers to matching subscriptions
   ├── Broadcast saga sends to renderer windows + STDIO
   └── Agent subscription saga checks agent filters
   ↓
7. UI components update via Redux selectors
```

## Best Practices

1. **Use `emitWorkspaceEvent` for full events**: When you need persistence, filtering, query support
2. **Use `domainEventEmitted` for simple broadcasts**: Terminal output, real-time updates
3. **Import pure utilities from features/events/main**: EventStore, EventQueryEngine, EventFilterEngine
4. **Use EventFilterBuilder**: For type-safe filter construction
5. **Dispatch via `mainDispatch`**: All event emission goes through Redux

## Configuration

All event system timing is centralized in `src/features/file-tracking/tracking.config.ts`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `events.persistEvents` | true | Whether to save events to disk |
| `events.maxEventsPerWorkspace` | 10000 | Maximum events before compaction |
| `events.maxEventAge` | 7 days | Events older than this are compacted |
| `events.batchInterval` | 100ms | Batching interval for event emission |
| `events.deduplicationWindow` | 1000ms | Window for detecting duplicate events |
| `events.saveDebounce` | 1000ms | Debounce time for disk saves |

## Deprecated Channels

The following IPC channels are deprecated and should not be used in new code:

| Deprecated Channel | Replacement |
|-------------------|-------------|
| `activity-log:get-entries` | `events:query` |
| `activity-log:add-entry` | `events:emit` |
| `activity-log:clear` | `events:clear` |

These channels are kept for backward compatibility but no longer have active handlers.

---

## IPC Event Handling in the Renderer

### Event Emission Patterns

Events can arrive in the renderer via two different emission patterns:

#### Pattern A: Direct IPC (Flat Data)
```typescript
// Main process emits:
window.webContents.send('agent:renamed', { agentId, workspaceId, name });

// Renderer receives via listenSync:
// { payload: { agentId, workspaceId, name } }
```

#### Pattern B: Redux Event (Wrapped Data)
```typescript
// Main process emits via Redux workspace-events slice:
mainDispatch(emitWorkspaceEvent(
  createWorkspaceEvent('agent:deleted', workspaceId, actor, { agentId, agentName })
));
// Broadcast saga sends the full event object to renderer windows:
window.webContents.send('agent:deleted', event);

// Renderer receives via listenSync:
// { payload: { type: 'agent:deleted', id: '...', data: { agentId, agentName } } }
```

### The `listenSync` Wrapping

The `listenSync` function in `electron-bridge.ts` always wraps incoming data:

```typescript
const listener = (data: T) => {
  handler({ payload: data });  // Always wraps in { payload: data }
};
```

### Using `extractEventData()` Helper

To safely handle both patterns, use the `extractEventData()` helper from `$lib/electron-bridge`:

```typescript
import { listenSync, extractEventData } from '$lib/electron-bridge';
import type { AgentDeletedPayload } from '$features/events/types';

// Extract a specific field (works for both patterns)
listenSync('agent:deleted', (event: any) => {
  const agentId = extractEventData<string>(event, 'agentId');
  if (typeof agentId === 'string') {
    handleAgentDeleted(agentId);
  } else {
    logger.warn('Received agent:deleted with invalid agentId', { event });
  }
});

// Extract the full data object
listenSync('agent:renamed', (event: any) => {
  const data = extractEventData<AgentRenamedPayload>(event);
  if (data && typeof data.agentId === 'string') {
    handleAgentRenamed(data);
  }
});
```

### Best Practices for Event Handlers

1. **Always use `extractEventData()`** for new handlers - it handles both emission patterns
2. **Add validation** - Always verify the extracted data has the expected shape:
   ```typescript
   const agentId = extractEventData<string>(event, 'agentId');
   if (typeof agentId !== 'string') {
     logger.warn('Unexpected event format', { event });
     return;
   }
   ```
3. **Use TypeScript types** - Import payload types from `$features/events/types`:
   ```typescript
   import type { AgentDeletedPayload, AgentRenamedPayload } from '$features/events/types';
   ```
4. **Log unexpected formats** - Don't silently fail when data extraction fails
5. **Prefer Redux `emitWorkspaceEvent` for new events** - It provides consistent structure and better observability

### Common Pitfalls

❌ **DON'T** assume the event format without checking:
```typescript
// BAD: Assumes flat format - breaks with Redux WorkspaceEvent objects
listenSync('agent:deleted', (event) => {
  const agentId = event.payload;  // Could be a WorkspaceEvent object!
  agents = agents.filter(a => a.id !== agentId);  // String vs Object comparison always true
});
```

✅ **DO** use `extractEventData()` and validate:
```typescript
// GOOD: Handles both patterns and validates
listenSync('agent:deleted', (event) => {
  const agentId = extractEventData<string>(event, 'agentId');
  if (typeof agentId === 'string') {
    agents = agents.filter(a => a.id !== agentId);
  }
});
```

### IPC Payload Type Definitions

Type definitions for IPC event payloads are available in `src/features/events/types.ts`:

| Type | Event Channel | Description |
|------|---------------|-------------|
| `AgentDeletedPayload` | `agent:deleted` | Agent deletion data |
| `AgentRenamedPayload` | `agent:renamed` | Agent rename data |
| `AgentCreatedPayload` | `agent:created` | Agent creation data |
| `AgentSubscribedPayload` | `agent:subscribed` | Agent subscription data |
| `AgentUnsubscribedPayload` | `agent:unsubscribed` | Agent unsubscription data |
| `AgentIdlePayload` | `agent:idle` | Agent idle state data |
| `AgentStatusChangedPayload` | `agent:status-changed` | Agent status change data |
| `NoteCreatedPayload` | `note:created` | Note creation data |
| `NoteUpdatedPayload` | `note:updated` | Note update data |
| `NoteDeletedPayload` | `note:deleted` | Note deletion data |
| `TaskStatusChangedPayload` | `task:status-changed` | Task status change data |
| `IpcEventWrapper<T>` | (any) | Wrapper for listenSync events |

### Debugging Event Issues

If events aren't being handled correctly:

1. **Log the raw event** to see its actual structure:
   ```typescript
   listenSync('event-name', (event) => {
     console.log('Raw event:', JSON.stringify(event, null, 2));
   });
   ```

2. **Check the emission source** - Is it using direct IPC or Redux events?
   - Search for `webContents.send('event-name'` for direct IPC
   - Search for `emitWorkspaceEvent(` for Redux-based events

3. **Use `isWorkspaceEvent()` type guard** to understand the format:
   ```typescript
   import { isWorkspaceEvent } from '$lib/electron-bridge';

   listenSync('event-name', (event) => {
     const payload = event.payload;
     if (isWorkspaceEvent(payload)) {
       console.log('WorkspaceEvent format, data:', payload.data);
     } else {
       console.log('Flat format:', payload);
     }
   });
   ```
