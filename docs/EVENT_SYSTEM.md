# Event System Architecture

**Version**: 2.0
**Date**: 2026-01-07
**Purpose**: Comprehensive guide to the unified event system

## Overview

The Intent app uses a unified event bus system that handles two types of events:

1. **WorkspaceEvents**: Full-featured events with persistence, deduplication, filtering
2. **DomainEvents**: Simple broadcast events for terminal, notes, comments, etc.

> **Migration Note**: The legacy `ACTIVITY_LOG` IPC channels (`activity-log:get-entries`, `activity-log:add-entry`, `activity-log:clear`) are deprecated. Use the `EVENTS` channels instead. See [IPC Registry](../src/shared/ipc-registry.ts) for migration details.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Renderer Process                             │
├─────────────────────────────────────────────────────────────────┤
│  Components          UnifiedEventBusClient         Stores       │
│  ┌─────────┐         ┌──────────────────┐    ┌─────────────┐   │
│  │ UI      │◄────────│ Singleton proxy  │◄───│ Reactive    │   │
│  │ Layer   │────────►│ via IPC          │───►│ State       │   │
│  └─────────┘         └────────┬─────────┘    └─────────────┘   │
└──────────────────────────────┼──────────────────────────────────┘
                               │ IPC
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Main Process                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  UnifiedEventBus                         │    │
│  │  (Singleton - handles all events)                        │    │
│  │                                                          │    │
│  │  • emitEvent(event, context) - WorkspaceEvents          │    │
│  │  • emitDomainEvent(name, data) - DomainEvents           │    │
│  │  • subscribe(options) - Filtered subscriptions          │    │
│  │  • query(workspaceId, filters) - Historical query       │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│           ┌───────────────┼───────────────┐                     │
│           ▼               ▼               ▼                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ EventStore   │ │ QueryEngine  │ │ Deduplication│            │
│  │ (per WS)     │ │ (per WS)     │ │ Service      │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              WorkspaceEventService                       │    │
│  │  (per workspace - integrates with ChangeDetector)       │    │
│  │                                                          │    │
│  │  • Listens to activity-log-event from ChangeDetector    │    │
│  │  • Coordinates note events                               │    │
│  │  • Historical sync                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Event Types

### WorkspaceEvents (Full Events)

Used for file changes, agent actions, git operations. Features:
- Unique ID and timestamp
- Actor attribution (user, agent, system)
- Workspace scoping
- Persistence to disk
- Deduplication
- Filterable queries

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
- Simple emit/listen pattern
- Broadcasts to all renderer windows
- Last event caching
- STDIO broadcasting for MCP

```typescript
// Emit a domain event
unifiedEventBus.emitDomainEvent('terminal:data', { terminalId, data });

// Listen to domain events
unifiedEventBus.onDomainEvent('note:updated', (data) => { ... });
```

## Key Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| UnifiedEventBus | `events/main/unified-event-bus.ts` | Singleton, handles all events |
| UnifiedEventBusClient | `events/renderer/unified-event-bus-client.ts` | Renderer proxy via IPC |
| WorkspaceEventBus | `events/main/workspace-event-bus.ts` | Per-workspace filtering |
| WorkspaceEventService | `events/main/workspace-event-service.ts` | ChangeDetector integration |
| EventStore | `events/main/event-store.ts` | Persistence to disk |
| EventQueryEngine | `events/main/event-query-engine.ts` | Complex event queries |
| EventFilterEngine | `events/event-filter-engine.ts` | Filter matching logic |

## Singleton Management

```typescript
// Get or create event service for a workspace
import { getWorkspaceEventService, cleanupWorkspaceEventService } from '../events/main';

const service = getWorkspaceEventService(workspaceId);
// or with options:
const service = getWorkspaceEventService({ workspaceId, changeDetector });

// Cleanup when workspace closes
cleanupWorkspaceEventService(workspaceId);
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
5. WorkspaceEventService receives event
   ↓
6. UnifiedEventBus.emitEvent()
   ├── Deduplication check
   ├── Store in EventStore
   ├── Notify subscribers
   └── Broadcast to renderer windows
   ↓
7. UI components update via stores
```

## Best Practices

1. **Use emitEvent for WorkspaceEvents**: When you need persistence, filtering, deduplication
2. **Use emitDomainEvent for simple broadcasts**: Terminal output, real-time updates
3. **Always import from index**: `import { getWorkspaceEventService } from '../events/main'`
4. **Cleanup on workspace close**: Call `cleanupWorkspaceEventService(id)`
5. **Use EventFilterBuilder**: For type-safe filter construction

## Event Bus Hierarchy

```
UnifiedEventBus (Singleton)
├── Handles cross-workspace subscriptions
├── Broadcasts to renderer windows (via IPC)
├── Broadcasts to STDIO (for MCP clients)
└── Does NOT own EventStore (pub/sub only)

WorkspaceEventBus (Per-workspace)
├── Owns EventStore for persistence
├── Handles per-workspace filtering
├── Deduplicates events
├── Forwards to UnifiedEventBus for cross-workspace
└── Broadcasts to renderer windows

WorkspaceEventService (Per-workspace)
├── Integrates ChangeDetector with EventBus
├── Listens to 'activity-log-event' from ChangeDetector
├── Handles note events
└── Manages service lifecycle
```

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

#### Pattern B: WorkspaceEventBus (Wrapped Data)
```typescript
// Main process emits via WorkspaceEventBus:
eventBus.emitEvent({ type: 'agent:deleted', id: '...', data: { agentId, agentName } });
// broadcastToRenderer sends the full event object:
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
5. **Prefer WorkspaceEventBus for new events** - It provides consistent structure and better observability

### Common Pitfalls

❌ **DON'T** assume the event format without checking:
```typescript
// BAD: Assumes flat format - breaks with WorkspaceEventBus events
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

2. **Check the emission source** - Is it using direct IPC or WorkspaceEventBus?
   - Search for `webContents.send('event-name'` for direct IPC
   - Search for `emitEvent({ type: 'event-name'` for WorkspaceEventBus

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
