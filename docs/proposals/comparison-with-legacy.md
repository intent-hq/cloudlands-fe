# Comparison: New Note-Centric Approach vs. Legacy Task Proposal

## TL;DR

**Old Approach**: Tasks as first-class entities, separate from notes
**New Approach**: Tasks as optional metadata within notes

The new approach is simpler, more flexible, and leverages existing infrastructure.

## Side-by-Side Comparison

### Data Model

| Aspect | Legacy Proposal | New Approach |
|--------|----------------|--------------|
| **Primary Entity** | Task (separate from Note) | Note (with optional task metadata) |
| **Storage** | `task-abc.json` + `task-abc.md` | Single `note-abc.json` |
| **Task Metadata** | Separate JSON file | `note.metadata.task` field |
| **Dependencies** | `task.dependencies[]` | `note.metadata.dependencies[]` |
| **Content** | Separate markdown file | `note.content` |
| **Coupling** | Loose (two files) | Tight (one file) |

### Example Data Structure

#### Legacy Approach
```typescript
// task-auth.json
{
  "id": "task-auth",
  "objective": "Implement authentication",
  "canonicalNoteId": "note-auth",
  "dependencies": ["task-db-setup"],
  "status": "blocked",
  "assignedAgents": ["agent-123"]
}

// note-auth.md (separate file)
# Authentication Implementation
Details about the authentication system...
```

#### New Approach
```typescript
// note-auth.json (single file)
{
  "id": "note-auth",
  "title": "Authentication Implementation",
  "content": "Details about the authentication system...",
  "metadata": {
    "task": {
      "status": "blocked",
      "priority": "high",
      "assignedAgentId": "agent-123"
    },
    "dependencies": [
      {
        "noteId": "note-db-setup",
        "type": "prerequisite",
        "reason": "Need database for user storage"
      }
    ]
  }
}
```

## Key Differences

### 1. Entity Model

**Legacy**: Two entities (Task + Note)
- Task contains orchestration metadata
- Note contains narrative/context
- Linked by `canonicalNoteId`

**New**: One entity (Note)
- Note contains everything
- Task metadata is optional
- No linking needed

**Winner**: New approach - simpler, less duplication

### 2. "Not All Notes Are Tasks" Problem

**Legacy**: Didn't address this
- Assumed all tasks have notes
- Didn't consider notes without tasks
- No clear way to convert between types

**New**: Explicitly designed for this
- Notes are primary, tasks are optional
- "Make this a task" button adds metadata
- "Remove task metadata" demotes back to note
- Progressive disclosure in UI

**Winner**: New approach - directly solves the problem

### 3. Storage and Persistence

**Legacy**: Two files per task
```
workspace/
  tasks/
    task-auth.json
    task-db-setup.json
  notes/
    note-auth.md
    note-db-setup.md
```

**New**: One file per note
```
workspace/
  notes/
    note-auth.json
    note-db-setup.json
```

**Winner**: New approach - simpler file structure

### 4. Querying

**Legacy**: Query tasks separately from notes
```typescript
const tasks = await tasksService.getAll();
const blockedTasks = tasks.filter(t => t.status === 'blocked');
```

**New**: Query notes, filter by task metadata
```typescript
const notes = await notesService.getAll();
const blockedTasks = notes.filter(n => n.metadata?.task?.status === 'blocked');
```

**Winner**: Tie - similar complexity

### 5. UI Rendering

**Legacy**: Separate UI for tasks and notes
- Task list shows tasks
- Notes panel shows notes
- Need to link between them

**New**: Unified UI with conditional rendering
- Notes panel shows all notes
- Task badges appear when `metadata.task` exists
- Single view with progressive disclosure

**Winner**: New approach - more cohesive UX

### 6. Agent Integration

**Legacy**: Agents work with tasks
```typescript
// Agent assigned to task
const task = await tasksService.get(taskId);
const note = await notesService.get(task.canonicalNoteId);
// Read note for context, update task for status
```

**New**: Agents work with notes
```typescript
// Agent assigned to note
const note = await notesService.get(noteId);
// Everything in one place
if (note.metadata?.task) {
  // It's a task, read acceptance criteria
}
```

**Winner**: New approach - simpler agent code

### 7. Versioning and History

**Legacy**: Separate versioning for tasks and notes
- Task history tracks status changes
- Note history tracks content changes
- Two timelines to reconcile

**New**: Unified versioning
- Note versions include task metadata changes
- Single timeline for all changes
- Easier to understand history

**Winner**: New approach - unified history

### 8. Comments and Collaboration

**Legacy**: Comments on notes, not tasks
- Comments live on note
- Task discussions separate from note discussions
- Fragmented conversation

**New**: Comments on notes (which may be tasks)
- All comments in one place
- Task discussions and content discussions unified
- Cohesive conversation

**Winner**: New approach - unified collaboration

## What We Kept from Legacy Proposal

Despite the different approach, we kept these good ideas:

1. **Task Status Lifecycle** - Same states (proposed, blocked, ready, in_progress, complete)
2. **Dependency Graph** - DAG structure with cycle detection
3. **Agent Orchestration** - Agents assigned to work, can propose prerequisites
4. **Acceptance Criteria** - Clear goals for task completion
5. **Blocking/Unblocking** - Automatic status updates when dependencies complete

## What We Changed

1. **Entity Model** - One entity instead of two
2. **Storage** - Single file instead of two
3. **Coupling** - Tight integration instead of loose coupling
4. **UI** - Progressive disclosure instead of separate views
5. **Flexibility** - Notes can become tasks and vice versa

## Migration Path

If you have code from the abandoned branch:

### 1. Data Migration
```typescript
// Convert old task + note to new note
async function migrateTask(task: LegacyTask, note: LegacyNote): Promise<Note> {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    // ... other note fields ...
    metadata: {
      task: {
        status: task.status,
        priority: task.priority,
        assignedAgentId: task.assignedAgents[0], // Take first agent
        acceptanceCriteria: task.acceptanceCriteria,
      },
      dependencies: task.dependencies.map(depId => ({
        noteId: depId.replace('task-', 'note-'), // Convert task ID to note ID
        type: 'prerequisite',
        createdAt: new Date().toISOString(),
      })),
    },
  };
}
```

### 2. Service Layer
- `TasksService` → `TaskMetadataService`
- Methods mostly the same, but operate on notes instead of tasks
- Graph algorithms can be reused

### 3. MCP Tools
- Update tool signatures to use `noteId` instead of `taskId`
- Logic mostly the same

### 4. UI Components
- Task status badges can be reused
- Dependency visualization can be reused
- Just need to adapt to note-centric model

## Advantages of New Approach

1. **Simpler** - One entity instead of two
2. **More flexible** - Notes can transition between types
3. **Leverages existing** - Uses note infrastructure (versioning, comments, references)
4. **Better UX** - Unified view with progressive disclosure
5. **Easier to implement** - Extends existing code rather than creating parallel systems
6. **Solves "not all notes are tasks"** - Explicitly designed for this

## Potential Concerns

### "What if task metadata gets too large?"

**Answer**: It won't. Task metadata is small:
- Status: 1 string
- Priority: 1 string
- Assigned agent: 1 ID
- Acceptance criteria: Array of strings (typically 3-5)
- Dependencies: Array of references (typically 1-3)

Total: ~1-2 KB per task, negligible compared to note content.

### "What if we want to query tasks efficiently?"

**Answer**: Multiple strategies:
1. In-memory index of task notes (fast)
2. Derived state in NotesStore (reactive)
3. Separate graph service for complex queries
4. File system could add task index if needed

### "What if we want task-specific features that don't fit in notes?"

**Answer**: Extend the metadata:
```typescript
metadata: {
  task: {
    // ... existing fields ...
    customField: 'custom value',
  }
}
```

The metadata field is extensible by design.

## Conclusion

The new note-centric approach is **simpler, more flexible, and better aligned with the existing codebase**. It directly addresses the "not all notes are tasks" challenge and provides a clear path forward.

The legacy proposal had good ideas (task graph, agent orchestration, status lifecycle), but the entity model was too complex. By embedding task metadata in notes, we get the benefits without the complexity.

**Recommendation**: Proceed with the new approach as outlined in the implementation plan.
