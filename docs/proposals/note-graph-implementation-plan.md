# Note Graph Implementation Plan

## Executive Summary

This document outlines a phased approach to implementing a **note-based task dependency graph** where notes can optionally represent tasks with metadata like status, dependencies, and progress tracking. This approach builds on the existing Note infrastructure rather than creating a separate Task entity.

## Key Insight: Notes as Flexible Containers

**Not all notes are tasks, but any note can become a task.** This is the fundamental design principle:

- Notes remain the primary content container
- Task metadata is **optional** and lives within the note's `metadata` field
- The graph structure emerges through note references and explicit dependency metadata
- UI can render notes differently based on whether they have task metadata

## Comparison with Original Proposal

### Original Proposal (Abandoned)
- Tasks as first-class entities separate from notes
- Task metadata in separate JSON files (`task-abc.json`)
- Task notes as companions (`task-abc.md`)
- Loose coupling between task data and note content

### New Approach (Note-Centric)
- Notes as the single source of truth
- Task metadata embedded in `note.metadata.task`
- Dependencies tracked via `note.metadata.dependencies`
- Tighter integration with existing note infrastructure

### Why This Is Better
1. **Simpler data model** - One entity instead of two
2. **Leverages existing infrastructure** - Notes already have versioning, comments, references
3. **More flexible** - Notes can transition between being tasks and regular notes
4. **Better UX** - Users work with notes they already understand
5. **Easier to implement** - Extends existing code rather than creating parallel systems

## Core Data Model

### Extended Note Type

```typescript
interface Note {
  // ... existing fields ...
  metadata?: {
    // ... existing metadata ...

    // Task-specific metadata (optional)
    task?: TaskMetadata;

    // Dependency tracking
    dependencies?: NoteDependency[];
    // Note: dependents are computed on-demand, not stored
  }
}

interface TaskMetadata {
  status: TaskStatus;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assignedAgentIds?: AgentId[]; // Current agents working on this task
  agentHistory?: Array<{
    agentId: AgentId;
    assignedAt: string;
    unassignedAt?: string;
    outcome?: 'completed' | 'abandoned' | 'reassigned';
  }>;
  acceptanceCriteria?: string[];
  estimatedEffort?: string;
  actualEffort?: string;
  blockedReason?: string;
  completedAt?: string;
  startedAt?: string;
}

interface NoteDependency {
  noteId: NoteId;
  type: 'blocks' | 'related' | 'prerequisite';
  reason?: string;
  createdAt: string;
}

// Note: dependents are NOT stored in metadata
// They are computed on-demand to avoid denormalization issues

type TaskStatus =
  | 'proposed'      // Suggested but not accepted
  | 'not_started'   // Accepted but not begun
  | 'blocked'       // Waiting on dependencies
  | 'ready'         // Dependencies met, ready to work
  | 'in_progress'   // Actively being worked on
  | 'complete'      // Finished
  | 'cancelled';    // Abandoned
```

## Phase 1A: Basic Task Metadata (Week 1)

### 1A.1 Extend Note Schema
- [ ] Add `task` field to `NoteMetadata` interface
- [ ] Add `dependencies` field (dependents computed on-demand)
- [ ] Update Zod schemas for validation
- [ ] Add migration for existing notes (no-op, just schema)

### 1A.2 Basic Task Operations in NotesService
- [ ] Add `markAsTask(noteId, workspaceId, taskData)` - Add task metadata to a note
- [ ] Add `updateTaskStatus(noteId, workspaceId, status)` - Update task status
- [ ] Add `removeTaskMetadata(noteId, workspaceId)` - Demote task back to regular note
- [ ] Add `getTaskNotes(workspaceId)` - Query all notes with task metadata
- [ ] Basic status validation (e.g., valid status values)

**Deliverable**: Notes can have task metadata with basic CRUD operations. No dependencies yet.

## Phase 1B: Dependencies & Graph (Week 2)

### 1B.1 Dependency Operations in NotesService
- [ ] Add methods to NotesService:
  - `addDependency(noteId, workspaceId, dependency)` - **Create dependency with on-demand note creation**
    - Can link to existing note via `existingNoteId`
    - Can create new prerequisite note via `title` + `content`
    - Automatically marks created notes as tasks with `not_started` status
    - Includes cycle detection (cleans up created note if cycle detected)
    - Optionally emits `note:agent-spawn-requested` event for Phase 3
  - `removeDependency(noteId, dependsOnNoteId)` - Remove dependency (does NOT delete auto-created notes)
  - `getDependencies(noteId)` - Get notes this note depends on
  - `getDependents(noteId)` - Get notes that depend on this note
  - `getBlockedNotes(workspaceId)` - Query notes with blocked status
  - `getReadyNotes(workspaceId)` - Query notes ready to work on (dependencies complete)
- [ ] Automatic status updates based on dependencies
- [ ] Status validation (can't mark as complete if dependencies incomplete)
- [ ] Cycle detection for dependencies (prevent circular dependencies)
- [ ] Topological sort helper for execution order (if needed)

**Key Design Decision**: `addDependency` creates notes on-demand to support agent workflows where an agent realizes a prerequisite is needed and wants to spawn another agent to work on it. This makes the API more powerful for agent collaboration.

**Rationale**: Keep all note operations in NotesService rather than fragmenting across multiple services. Task operations are just specialized note operations. Graph queries traverse notes on-demand (compute dependents rather than caching).

**Deliverable**: Full dependency graph with cycle detection, automatic status updates, and graph queries

## Phase 2: Minimal UI (Week 3)

### 2.1 Pull UI from Abandoned Branch
- [ ] Review `tchu-task-note-rendering` branch for reusable components
- [ ] Extract task status badge component
- [ ] Extract basic task metadata display
- [ ] Adapt to work with note-based model (instead of separate task entity)

### 2.2 Basic Task Indicators
- [ ] Show task status badge on notes that have `metadata.task`
- [ ] Simple color coding: blocked (red), in_progress (yellow), complete (green)
- [ ] "Make this a task" button in note editor

**Deliverable**: Minimal UI to see which notes are tasks and their status. Focus on getting to Phase 3 quickly.

## Phase 3: Agent Integration (Week 4-5)

**Priority**: Get here as quickly as possible after Phase 1. This is where the real value is.

### 3.1 MCP Tools for Task Management
- [ ] `mark_note_as_task` - Convert note to task with acceptance criteria
- [ ] `update_task_status` - Change task status (with validation)
- [ ] `link_task_dependency` - Link to existing note as dependency (with cycle detection)
- [ ] `propose_prerequisite` - **Create new prerequisite note and link as dependency**
  - Takes: currentTaskId, prerequisiteTitle, prerequisiteDescription, reason, spawnAgent flag
  - Creates new note, marks as task, adds dependency, optionally spawns agent
  - Returns: prerequisiteId, currentTaskId, agentSpawned flag
  - This is the primary tool for agent collaboration workflows
- [ ] `remove_task_dependency` - Remove dependency
- [ ] `get_task_dependencies` - Query what this note depends on
- [ ] `get_task_dependents` - Query what depends on this note
- [ ] `get_ready_tasks` - Query tasks ready to work on
- [ ] `get_blocked_tasks` - Query tasks that are blocked

### 3.2 Agent Task Assignment
- [ ] When agent is created with a task context, add `assignedNoteId` to contextual references
- [ ] Agent system prompt includes task context (noteId, status, acceptance criteria)
- [ ] When agent starts work, add to `task.assignedAgentIds[]`
- [ ] When agent finishes/abandons, move to `task.agentHistory[]`
- [ ] Agent can query "What note am I working on?" via context
- [ ] Agent can read task metadata (status, acceptance criteria, dependencies)

### 3.3 Task-Aware Agent Rules
- [ ] Update agent system prompt to understand task context
- [ ] Agent reads acceptance criteria from note metadata
- [ ] Agent checks if dependencies are complete before starting
- [ ] Agent can propose prerequisites when blocked
- [ ] Agent updates status as work progresses

### 3.4 Automatic Status Updates
- [ ] When all dependencies complete → status automatically changes to 'ready'
- [ ] When agent marks complete → check dependents and unblock them
- [ ] Emit events for status changes (for UI reactivity)

**Deliverable**: Agents can work with task-notes, understand dependencies, and update status. This is the core value proposition.

## Future Enhancements (Post-MVP)

Once the core system is working (Phases 1-3), consider these enhancements based on actual usage:

### UI Improvements
- Dependency picker with search
- Visual graph rendering
- Task filtering and sorting
- Progress indicators

### Agent Capabilities
- Task breakdown (`break_down_task` tool)
- Task templates
- Automatic prerequisite discovery
- Smart notifications

### Performance
- In-memory graph cache (if needed)
- Incremental updates (if needed)
- Query optimization (if needed)

**Note**: Don't build these until you have real usage data showing they're needed. The core system (Phases 1-3) should be sufficient to validate the approach.

## Key Design Decisions

### 1. Why Not Separate Services?

**Question**: Why not create TaskMetadataService and NoteGraphService?

**Answer**: Keep it simple. Task operations are just specialized note operations:
- `markAsTask()` is just updating `note.metadata.task`
- `addDependency()` is just updating `note.metadata.dependencies`
- Graph queries are infrequent and can traverse notes directly

**Benefits**:
- Single source of truth (NotesService)
- Simpler mental model (everything is a note operation)
- Less code to maintain
- Easier to reason about transactions and consistency

**When to split**: Only if NotesService becomes too large (>1000 lines) or if you need to swap graph implementations.

### 2. How to Handle "Not All Notes Are Tasks"

**Solution**: Progressive disclosure
- By default, notes are just notes
- "Make this a task" button adds task metadata
- UI shows task-specific features only when `metadata.task` exists
- Notes can be "demoted" back to regular notes (remove task metadata)

### 3. How to Represent Dependencies

**Solution**: Explicit metadata + cached denormalization
- Dependencies stored in `metadata.dependencies[]`
- Dependents cached in `metadata.dependents[]` for performance
- NotesService keeps these in sync
- Graph queries use both for bidirectional traversal

### 4. How to Integrate with Existing Note Features

**Solution**: Composition over inheritance
- Task metadata is additive, doesn't replace note features
- Comments work on task-notes
- Versions work on task-notes
- References work on task-notes
- Task-specific UI is layered on top

### 5. How to Handle Cycles

**Solution**: Prevention + detection
- Cycle detection when adding dependencies (in NotesService)
- Reject dependency if it would create cycle
- UI shows error: "This would create a circular dependency"
- Graph algorithms assume DAG (Directed Acyclic Graph)

### 6. How to Handle Deleted Notes

**Solution**: Graceful degradation
- When note is deleted, remove it from all dependency lists
- Dependent notes show "Dependency deleted" with option to remove
- Don't block deletion of notes with dependents (just warn)

## Migration from Abandoned Branch

Review `tchu-task-note-rendering` branch for reusable code:

1. **UI components** - Task status badges, task metadata panels (adapt to note-based model)
2. **Task metadata structure** - Can be adapted to fit in `note.metadata.task`
3. **Agent rules** - Task-loop rules can be updated to work with note-based tasks
4. **MCP tools** - Tool signatures can be updated to work with noteId instead of taskId

## Success Metrics

After Phase 3 is complete, measure:

1. **Agent effectiveness**: Can agents successfully work through task dependencies?
2. **Blocking reduction**: Do agents get stuck less often with task system?
3. **Context preservation**: Is context maintained across task boundaries?
4. **Completion rate**: Do complex multi-step tasks actually get finished?

These metrics will tell you if the system is working and what to build next.

## Implementation Strategy

**Timeline**: 5 weeks total
- Phase 1A: 1 week (Basic Task Metadata)
- Phase 1B: 1 week (Dependencies & Graph)
- Phase 2: 1 week (Minimal UI)
- Phase 3: 2 weeks (Agent Integration - the real value)

**Approach**:
1. Build Phase 1A (basic task metadata) - validate quickly
2. Build Phase 1B (dependencies) - complete the foundation
3. Add minimal UI in Phase 2 (just enough to see it working)
4. Rush to Phase 3 (agent integration is where the value is)
5. Validate with real usage before building anything else

**Key Principle**: Don't build speculative features. Build the minimum to validate the approach, then iterate based on actual usage.

## Next Steps

1. **Review this plan** - Does the simplified approach make sense?
2. **Check abandoned branch** - What UI components can be reused?
3. **Prototype Phase 1** - Start with schema and NotesService methods
4. **Validate early** - Test with simple workflows before building more
