# Note Graph Proposal Updates

## Date: 2025-11-25

## Summary of Changes

Based on user feedback, we've updated the note graph proposal with several key design decisions:

1. **`addDependency` creates notes on-demand** to support agent collaboration workflows
2. **Dependents computed on-demand** rather than cached to avoid denormalization issues
3. **Multiple agents per task** with full agent history tracking
4. **Phase 1 split into 1A and 1B** for faster validation
5. **Agent-task relationship via contextual references** in agent system prompt

## Key Design Decision

### Original Design
```typescript
addDependency(noteId, dependsOnNoteId, reason)
// Both notes must already exist
```

### New Design
```typescript
addDependency(noteId, workspaceId, {
  // Option 1: Link to existing note
  existingNoteId?: NoteId;

  // Option 2: Create new prerequisite note
  title?: string;
  content?: string;

  // Common fields
  type: DependencyType;
  reason?: string;

  // Optional: Request agent spawn
  spawnAgent?: { agentType?: string; prompt?: string; };
})
// Returns: { note: Note; createdNote?: Note }
```

## Rationale

This design enables the **prerequisite pattern** for agent collaboration:

1. Agent A is working on a task
2. Agent A realizes a prerequisite is needed
3. Agent A calls `propose_prerequisite` MCP tool
4. System creates new note, marks as task, links dependency
5. System optionally spawns Agent B to work on prerequisite
6. When Agent B completes, Agent A is automatically unblocked

## Files Updated

### 1. `note-graph-implementation-plan.md`
- Updated Phase 1 to reflect on-demand note creation in `addDependency`
- Added key design decision explanation
- Updated Phase 3 MCP tools to include `propose_prerequisite` tool
- Clarified that `removeDependency` does NOT delete auto-created notes

### 2. `note-graph-architecture.md`
- Replaced `addDependency` implementation with new design
- Added comprehensive error handling (cycle detection with cleanup)
- Added "Agent Collaboration Workflow" section with example
- Added "Implementation Considerations" section covering:
  - Note deletion with dependencies
  - Orphaned auto-created notes
  - Cycle detection with newly created notes
  - Concurrent modifications
  - Status validation
- Added testing strategy with unit test examples
- Updated MCP tools section with `propose_prerequisite` tool

## Implementation Details

### Cycle Detection with Cleanup

When creating a note on-demand, if a cycle is detected, the newly created note is automatically deleted:

```typescript
if (await this.wouldCreateCycle(noteId, dependencyNoteId, workspaceId)) {
  if (createdNote) {
    await this.deleteNote(createdNote.id, workspaceId);
  }
  return { ok: false, error: 'Would create circular dependency' };
}
```

### Agent Spawn Events

When `spawnAgent` is requested, the system emits an event that Phase 3 will handle:

```typescript
if (dependency.spawnAgent && createdNote) {
  this.eventBus.emit('note:agent-spawn-requested', {
    noteId: createdNote.id,
    workspaceId,
    agentType: dependency.spawnAgent.agentType,
    prompt: dependency.spawnAgent.prompt,
  });
}
```

### Automatic Task Marking

Newly created prerequisite notes are automatically marked as tasks:

```typescript
await this.markAsTask(dependencyNoteId, workspaceId, {
  status: 'not_started',
  priority: 'high', // Prerequisites are usually important
});
```

## Edge Cases Addressed

1. **Note Deletion**: When a note is deleted, it's removed from all dependent/dependency lists
2. **Orphaned Notes**: Auto-created notes are NOT deleted if parent is deleted (they may have gained value)
3. **Cycle Detection**: Happens after creation but before linking, with automatic cleanup
4. **Concurrent Modifications**: Use last-write-wins with event notifications (or optional optimistic locking)
5. **Status Validation**: Cannot mark task complete if dependencies aren't complete

## Testing Considerations

Added comprehensive test cases for:
- Linking to existing notes
- Creating new prerequisite notes
- Cycle detection and prevention
- Cleanup of created notes when cycles detected
- Status transitions based on dependencies
- Event emissions

## New Design Decisions (2025-11-25)

### 1. Compute Dependents On-Demand

**Decision**: Don't cache `dependents` in note metadata. Compute them on-demand by scanning all notes.

**Rationale**:
- Avoids denormalization and consistency issues
- Single source of truth (only `dependencies` stored)
- Simpler to implement and maintain
- Performance is acceptable for expected scale (< 1000 notes per workspace)

**Implementation**:
```typescript
async getDependents(noteId: NoteId, workspaceId: WorkspaceId): Promise<Note[]> {
  const allNotes = await this.notesRepository.findAll(workspaceId);
  return allNotes.filter(note =>
    note.metadata?.dependencies?.some(dep => dep.noteId === noteId)
  );
}
```

**Future Optimization**: If performance becomes an issue, add in-memory index that rebuilds on app start.

### 2. Multiple Agents Per Task

**Decision**: Tasks can have multiple agents working on them simultaneously, with full history tracking.

**Data Model**:
```typescript
interface TaskMetadata {
  assignedAgentIds?: AgentId[];  // Current agents
  agentHistory?: Array<{
    agentId: AgentId;
    assignedAt: string;
    unassignedAt?: string;
    outcome?: 'completed' | 'abandoned' | 'reassigned';
  }>;
  // ... other fields
}
```

**Agent Context**: When an agent is launched on a task, the `assignedNoteId` is added to the agent's contextual references (in system prompt), not just session metadata.

### 3. Split Phase 1 into 1A and 1B

**Decision**: Break Phase 1 into two sub-phases for faster validation.

**Phase 1A (Week 1)**: Basic task metadata
- Schema changes
- `markAsTask()`, `updateTaskStatus()`, `removeTaskMetadata()`
- Basic validation
- Get something working quickly

**Phase 1B (Week 2)**: Dependencies and graph
- `addDependency()`, `removeDependency()`
- Cycle detection
- Status propagation
- Graph queries

**Rationale**: Allows earlier validation, reduces risk, enables TDD approach.

## Next Steps

1. Define TDD increments for Phase 1A
2. Implement Phase 1A with comprehensive tests
3. Validate approach before proceeding to Phase 1B
4. Implement Phase 1B with dependency graph
5. Add minimal UI in Phase 2
6. Implement Phase 3 agent integration with `propose_prerequisite` tool
