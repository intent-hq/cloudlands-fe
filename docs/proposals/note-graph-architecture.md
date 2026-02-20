# Note Graph Architecture

## The "Not All Notes Are Tasks" Challenge

This is the central design challenge: how do we add task-like capabilities to notes without forcing all notes to be tasks?

### The Problem

In the original proposal, Tasks were first-class entities. This was clean but created duplication:
- Task metadata (JSON) + Task note (Markdown)
- Two storage locations, two update paths, two sources of truth

The new approach embeds task metadata in notes, but this raises questions:
- How do we query "all tasks" efficiently?
- How do we render notes differently based on whether they're tasks?
- How do we prevent task-specific UI from cluttering regular notes?

### The Solution: Type Discrimination + Progressive Disclosure

#### 1. Type Discrimination

Notes have an implicit "type" based on their metadata:

```typescript
function getNoteType(note: Note): 'regular' | 'task' | 'spec' {
  if (note.id === SPEC_NOTE_ID) return 'spec';
  if (note.metadata?.task) return 'task';
  return 'regular';
}
```

This allows:
- Type-specific rendering
- Type-specific queries
- Type-specific behaviors

#### 2. Progressive Disclosure

UI reveals task features only when relevant:

```svelte
{#if note.metadata?.task}
  <TaskStatusBadge status={note.metadata.task.status} />
  <TaskDependencies dependencies={note.metadata.dependencies} />
  <TaskActions {note} />
{/if}
```

Benefits:
- Regular notes remain uncluttered
- Task notes get rich task UI
- Smooth transition between types

#### 3. Efficient Querying

Index notes by type for fast queries:

```typescript
class NotesStore {
  // Derived state
  get taskNotes(): Note[] {
    return Array.from(this.notes.values())
      .filter(n => n.metadata?.task);
  }

  get regularNotes(): Note[] {
    return Array.from(this.notes.values())
      .filter(n => !n.metadata?.task && n.id !== SPEC_NOTE_ID);
  }
}
```

For larger datasets, maintain separate indexes:

```typescript
class NotesStore {
  #taskIndex = new Set<NoteId>();

  updateNote(note: Note) {
    if (note.metadata?.task) {
      this.#taskIndex.add(note.id);
    } else {
      this.#taskIndex.delete(note.id);
    }
  }
}
```

## Dependency Graph Architecture

### Graph Representation

Two complementary representations:

#### 1. Adjacency List (in Note metadata)

```typescript
interface Note {
  metadata: {
    dependencies: NoteDependency[];  // Outgoing edges
    // dependents computed on-demand, not stored
  }
}
```

Pros:
- Stored with the note
- Easy to serialize
- Natural for note-centric operations
- Single source of truth (no denormalization)

Cons:
- Computing dependents requires scanning all notes (O(n))
- Can be optimized with in-memory index if needed

#### 2. In-Memory Graph (for queries)

```typescript
class NoteGraphService {
  private graph: Map<NoteId, GraphNode>;

  interface GraphNode {
    noteId: NoteId;
    dependencies: Set<NoteId>;
    dependents: Set<NoteId>;
    status: TaskStatus;
  }

  // Build from notes
  rebuild(notes: Note[]) {
    this.graph.clear();
    for (const note of notes) {
      if (note.metadata?.task) {
        this.addNode(note);
      }
    }
  }

  // Incremental update
  updateNode(note: Note) {
    // Update graph without full rebuild
  }
}
```

Pros:
- Fast graph queries (BFS, DFS, topological sort)
- Easy cycle detection
- Efficient dependency resolution

Cons:
- Must be kept in sync with notes
- Memory overhead
- Needs rebuild on app start

### Graph Operations

#### Cycle Detection

```typescript
detectCycle(fromId: NoteId, toId: NoteId): boolean {
  // Would adding edge from->to create a cycle?
  // Use DFS from toId to see if we can reach fromId
  const visited = new Set<NoteId>();
  const stack = [toId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const node = this.graph.get(current);
    if (node) {
      stack.push(...node.dependencies);
    }
  }

  return false;
}
```

#### Topological Sort

```typescript
getExecutionOrder(noteIds: NoteId[]): NoteId[] {
  // Return notes in dependency order (prerequisites first)
  const result: NoteId[] = [];
  const visited = new Set<NoteId>();
  const temp = new Set<NoteId>();

  const visit = (id: NoteId) => {
    if (temp.has(id)) throw new Error('Cycle detected');
    if (visited.has(id)) return;

    temp.add(id);
    const node = this.graph.get(id);
    if (node) {
      for (const depId of node.dependencies) {
        visit(depId);
      }
    }
    temp.delete(id);
    visited.add(id);
    result.push(id);
  };

  for (const id of noteIds) {
    visit(id);
  }

  return result;
}
```

#### Ready Tasks Query

```typescript
getReadyTasks(): Note[] {
  const ready: Note[] = [];

  for (const [noteId, node] of this.graph) {
    if (node.status === 'blocked' || node.status === 'not_started') {
      // Check if all dependencies are complete
      const allDepsComplete = Array.from(node.dependencies)
        .every(depId => {
          const depNode = this.graph.get(depId);
          return depNode?.status === 'complete';
        });

      if (allDepsComplete) {
        const note = this.notesStore.findById(noteId);
        if (note) ready.push(note);
      }
    }
  }

  return ready;
}
```

## Service Layer Architecture

### Simplified Architecture

**Key Decision**: Keep all note operations in NotesService, including task operations.

**Rationale**:
- Task operations are just specialized note operations
- Avoids fragmenting logic across multiple services
- Single source of truth for all note state
- Simpler mental model
- Easier to maintain consistency

```
┌─────────────────────────────────────────────────────────┐
│                     Application Layer                    │
│  (UI Components, Agent Tools, MCP Protocol Adapter)     │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                   Service Layer                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │              NotesService                         │  │
│  │                                                   │  │
│  │  Basic Operations:                               │  │
│  │  - create(), update(), delete(), get()           │  │
│  │  - Validation, persistence                       │  │
│  │                                                   │  │
│  │  Task Operations:                                │  │
│  │  - markAsTask()                                  │  │
│  │  - updateTaskStatus()                            │  │
│  │  - addDependency() (with cycle detection)       │  │
│  │  - removeDependency()                            │  │
│  │                                                   │  │
│  │  Graph Queries:                                  │  │
│  │  - getDependencies()                             │  │
│  │  - getDependents()                               │  │
│  │  - getReadyNotes()                               │  │
│  │  - getBlockedNotes()                             │  │
│  │  - topologicalSort()                             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────┐                                   │
│  │ NotesStore       │                                   │
│  │ (Svelte State)   │                                   │
│  │ - Reactive state │                                   │
│  │ - Derived data   │                                   │
│  │ - Event handling │                                   │
│  └──────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  Repository Layer                        │
│  (FileSystemNotesRepository, InMemoryNotesRepository)   │
└─────────────────────────────────────────────────────────┘
```

### Extended NotesService

All task operations live in NotesService:

```typescript
class NotesService {
  // ... existing CRUD methods ...

  // Task Operations

  async markAsTask(
    noteId: NoteId,
    taskData: Partial<TaskMetadata>
  ): Promise<Note> {
    const note = await this.get(noteId);
    if (!note) throw new Error('Note not found');

    return await this.update(noteId, {
      metadata: {
        ...note.metadata,
        task: {
          status: 'not_started',
          ...taskData,
        },
      },
    });
  }

  async updateTaskStatus(
    noteId: NoteId,
    newStatus: TaskStatus
  ): Promise<Note> {
    const note = await this.get(noteId);
    if (!note?.metadata?.task) {
      throw new Error('Note is not a task');
    }

    // Validate status transition
    if (newStatus === 'complete') {
      const allDepsComplete = await this.areAllDependenciesComplete(noteId);
      if (!allDepsComplete) {
        throw new Error('Cannot complete: dependencies not met');
      }
    }

    const updatedNote = await this.update(noteId, {
      metadata: {
        ...note.metadata,
        task: {
          ...note.metadata.task,
          status: newStatus,
          ...(newStatus === 'complete' && { completedAt: new Date().toISOString() }),
        },
      },
    });

    // If completed, check dependents and unblock them
    if (newStatus === 'complete') {
      await this.checkDependentsForUnblock(noteId);
    }

    return updatedNote;
  }

  async addDependency(
    noteId: NoteId,
    workspaceId: WorkspaceId,
    dependency: {
      // Option 1: Link to existing note
      existingNoteId?: NoteId;

      // Option 2: Create new prerequisite note
      title?: string;
      content?: string;

      // Common fields
      type: DependencyType;
      reason?: string;

      // Optional: Request agent spawn for this prerequisite (handled in Phase 3)
      spawnAgent?: {
        agentType?: string;
        prompt?: string;
      };
    }
  ): Promise<Result<{ note: Note; createdNote?: Note }, string>> {
    // 1. Get the parent note
    const parentResult = await this.getNote(workspaceId, noteId);
    if (!parentResult.ok) return parentResult;
    const parentNote = parentResult.data;

    let dependencyNoteId: NoteId;
    let createdNote: Note | undefined;

    // 2. Either use existing or create new
    if (dependency.existingNoteId) {
      // Validate it exists
      const existsResult = await this.notesRepository.findById(
        workspaceId,
        dependency.existingNoteId
      );
      if (!existsResult.ok) {
        return { ok: false, error: 'Dependency note not found' };
      }
      dependencyNoteId = dependency.existingNoteId;

    } else if (dependency.title) {
      // Create new prerequisite note
      const createResult = await this.createNote({
        workspaceId,
        title: dependency.title,
        content: dependency.content || '',
        tags: ['prerequisite', 'auto-created'],
      });
      if (!createResult.ok) return createResult;

      createdNote = createResult.data;
      dependencyNoteId = createdNote.id;

      // Mark it as a task with 'not_started' status
      const markResult = await this.markAsTask(dependencyNoteId, workspaceId, {
        status: 'not_started',
        priority: 'high', // Prerequisites are usually important
      });
      if (!markResult.ok) {
        // Clean up created note
        await this.deleteNote(dependencyNoteId, workspaceId);
        return markResult;
      }

    } else {
      return { ok: false, error: 'Must provide either existingNoteId or title' };
    }

    // 3. Check for cycles
    if (await this.wouldCreateCycle(noteId, dependencyNoteId, workspaceId)) {
      // If we created a note, clean it up
      if (createdNote) {
        await this.deleteNote(createdNote.id, workspaceId);
      }
      return { ok: false, error: 'Would create circular dependency' };
    }

    // 4. Add dependency to parent note
    if (!parentNote.metadata) parentNote.metadata = {};
    if (!parentNote.metadata.dependencies) parentNote.metadata.dependencies = [];

    parentNote.metadata.dependencies.push({
      noteId: dependencyNoteId,
      type: dependency.type,
      reason: dependency.reason,
      createdAt: new Date().toISOString(),
    });

    // 5. Update parent's status if needed (might become blocked)
    await this.updateStatusBasedOnDependencies(noteId, workspaceId);

    // 6. Save parent note
    const saveResult = await this.notesRepository.save(parentNote);
    if (!saveResult.ok) return saveResult;

    // 7. Emit events
    this.eventBus.emit('note:dependency-added', {
      noteId,
      dependencyNoteId,
      workspaceId,
      created: !!createdNote,
    });

    // 8. Handle agent spawning if requested
    if (dependency.spawnAgent && createdNote) {
      // This would integrate with agent service in Phase 3
      // For now, just emit an event that Phase 3 can handle
      this.eventBus.emit('note:agent-spawn-requested', {
        noteId: createdNote.id,
        workspaceId,
        agentType: dependency.spawnAgent.agentType,
        prompt: dependency.spawnAgent.prompt,
      });
    }

    return {
      ok: true,
      data: {
        note: parentNote,
        createdNote
      }
    };
  }

  async removeDependency(
    noteId: NoteId,
    dependsOn: NoteId
  ): Promise<Note> {
    const note = await this.get(noteId);
    if (!note) throw new Error('Note not found');

    const dependencies = (note.metadata?.dependencies || [])
      .filter(d => d.noteId !== dependsOn);

    const updatedNote = await this.update(noteId, {
      metadata: {
        ...note.metadata,
        dependencies,
      },
    });

    // Check if status should change to ready
    await this.updateStatusBasedOnDependencies(noteId);

    return updatedNote;
  }

  // Graph Query Methods

  async getDependencies(noteId: NoteId): Promise<Note[]> {
    const note = await this.get(noteId);
    if (!note?.metadata?.dependencies) return [];

    const deps = await Promise.all(
      note.metadata.dependencies.map(d => this.get(d.noteId))
    );

    return deps.filter((n): n is Note => n !== null);
  }

  async getDependents(noteId: NoteId, workspaceId: WorkspaceId): Promise<Note[]> {
    // Compute on-demand by scanning all notes
    const allNotes = await this.notesRepository.findAll(workspaceId);

    return allNotes.filter(note =>
      note.metadata?.dependencies?.some(dep => dep.noteId === noteId)
    );
  }

  async getReadyNotes(): Promise<Note[]> {
    const allNotes = await this.getAll();
    const ready: Note[] = [];

    for (const note of allNotes) {
      if (!note.metadata?.task) continue;

      const status = note.metadata.task.status;
      if (status !== 'not_started' && status !== 'blocked') continue;

      const allDepsComplete = await this.areAllDependenciesComplete(note.id);
      if (allDepsComplete) {
        ready.push(note);
      }
    }

    return ready;
  }

  async getBlockedNotes(): Promise<Note[]> {
    const allNotes = await this.getAll();
    return allNotes.filter(n => n.metadata?.task?.status === 'blocked');
  }

  // Helper Methods

  private async wouldCreateCycle(
    fromId: NoteId,
    toId: NoteId
  ): Promise<boolean> {
    // DFS from toId to see if we can reach fromId
    const visited = new Set<NoteId>();
    const stack = [toId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === fromId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const note = await this.get(current);
      if (note?.metadata?.dependencies) {
        stack.push(...note.metadata.dependencies.map(d => d.noteId));
      }
    }

    return false;
  }

  private async areAllDependenciesComplete(noteId: NoteId): Promise<boolean> {
    const deps = await this.getDependencies(noteId);
    return deps.every(dep => dep.metadata?.task?.status === 'complete');
  }

  private async updateStatusBasedOnDependencies(noteId: NoteId): Promise<void> {
    const note = await this.get(noteId);
    if (!note?.metadata?.task) return;

    const allDepsComplete = await this.areAllDependenciesComplete(noteId);
    const currentStatus = note.metadata.task.status;

    if (allDepsComplete && currentStatus === 'blocked') {
      await this.update(noteId, {
        metadata: {
          ...note.metadata,
          task: { ...note.metadata.task, status: 'ready' },
        },
      });
    } else if (!allDepsComplete &&
               (currentStatus === 'ready' || currentStatus === 'not_started')) {
      await this.update(noteId, {
        metadata: {
          ...note.metadata,
          task: { ...note.metadata.task, status: 'blocked' },
        },
      });
    }
  }

  private async checkDependentsForUnblock(noteId: NoteId): Promise<void> {
    const dependents = await this.getDependents(noteId);
    for (const dependent of dependents) {
      await this.updateStatusBasedOnDependencies(dependent.id);
    }
  }

  // Note: addToDependent and removeFromDependent are no longer needed
  // since dependents are computed on-demand
}
```

## Implementation Considerations

### Edge Cases and Error Handling

#### 1. Note Deletion with Dependencies

**Problem**: What happens when a note is deleted that other notes depend on?

**Solution**: Remove from all dependent/dependency lists

```typescript
async deleteNote(noteId: NoteId, workspaceId: WorkspaceId): Promise<Result<void, string>> {
  const note = await this.getNote(workspaceId, noteId);
  if (!note.ok) return note;

  // 1. Find all notes that depend on this note (compute dependents)
  const dependents = await this.getDependents(noteId, workspaceId);
  for (const dependent of dependents) {
    await this.removeDependency(dependent.id, noteId, workspaceId);
  }

  // 2. No need to update dependencies' dependent lists since we compute on-demand

  // 3. Delete the note
  return await this.notesRepository.delete(workspaceId, noteId);
}
```

#### 2. Orphaned Auto-Created Notes

**Problem**: If `addDependency` creates a note but the parent is later deleted, should the created note be deleted?

**Solution**: No - the created note may have gained content/value. Keep it as a regular note.

**Rationale**:
- The note might have been worked on by an agent
- It might have its own dependencies now
- It's safer to leave orphaned notes than to delete potentially valuable work
- Users can manually delete if needed

#### 3. Cycle Detection with Newly Created Notes

**Problem**: Cycle detection needs to happen AFTER note creation but BEFORE linking.

**Solution**: Already handled in `addDependency` - we create the note, check for cycles, and clean up if cycle detected.

```typescript
// 3. Check for cycles
if (await this.wouldCreateCycle(noteId, dependencyNoteId, workspaceId)) {
  // If we created a note, clean it up
  if (createdNote) {
    await this.deleteNote(createdNote.id, workspaceId);
  }
  return { ok: false, error: 'Would create circular dependency' };
}
```

#### 4. Concurrent Modifications

**Problem**: Two agents might try to add dependencies simultaneously.

**Solution**: Use optimistic locking or last-write-wins with event notifications.

```typescript
// Option 1: Optimistic locking (add version field to Note)
interface Note {
  version: number;
  // ... other fields
}

async update(noteId: NoteId, updates: Partial<Note>): Promise<Result<Note, string>> {
  const current = await this.get(noteId);
  if (updates.version && updates.version !== current.version) {
    return { ok: false, error: 'Concurrent modification detected' };
  }

  const updated = {
    ...current,
    ...updates,
    version: current.version + 1,
  };

  return await this.notesRepository.save(updated);
}

// Option 2: Last-write-wins (simpler, current approach)
// Just save and emit events - UI will update reactively
```

#### 5. Status Validation

**Problem**: Can a task be marked complete if its dependencies aren't complete?

**Solution**: Validate in `updateTaskStatus`:

```typescript
async updateTaskStatus(
  noteId: NoteId,
  workspaceId: WorkspaceId,
  status: TaskStatus
): Promise<Result<Note, string>> {
  const note = await this.getNote(workspaceId, noteId);
  if (!note.ok) return note;

  // Validate status transition
  if (status === 'complete') {
    const allDepsComplete = await this.areAllDependenciesComplete(noteId, workspaceId);
    if (!allDepsComplete) {
      return {
        ok: false,
        error: 'Cannot mark as complete: dependencies are not complete'
      };
    }
  }

  // Update status
  const updated = {
    ...note.data,
    metadata: {
      ...note.data.metadata,
      task: {
        ...note.data.metadata.task,
        status,
        completedAt: status === 'complete' ? new Date().toISOString() : undefined,
      },
    },
  };

  const saveResult = await this.notesRepository.save(updated);
  if (!saveResult.ok) return saveResult;

  // Notify dependents they might be unblocked
  if (status === 'complete') {
    await this.checkDependentsForUnblock(noteId, workspaceId);
  }

  this.eventBus.emit('task:status-changed', {
    noteId,
    workspaceId,
    oldStatus: note.data.metadata?.task?.status,
    newStatus: status,
  });

  return { ok: true, data: updated };
}
```

### Testing Strategy

#### Unit Tests

```typescript
describe('NotesService - Task Operations', () => {
  describe('addDependency', () => {
    it('should link to existing note', async () => {
      const noteA = await service.createNote({ title: 'A' });
      const noteB = await service.createNote({ title: 'B' });

      const result = await service.addDependency(noteA.id, workspace.id, {
        existingNoteId: noteB.id,
        type: 'prerequisite',
      });

      expect(result.ok).toBe(true);
      expect(result.data.note.metadata.dependencies).toHaveLength(1);
      expect(result.data.createdNote).toBeUndefined();
    });

    it('should create new prerequisite note', async () => {
      const noteA = await service.createNote({ title: 'A' });

      const result = await service.addDependency(noteA.id, workspace.id, {
        title: 'Prerequisite',
        content: 'Do this first',
        type: 'prerequisite',
      });

      expect(result.ok).toBe(true);
      expect(result.data.createdNote).toBeDefined();
      expect(result.data.createdNote.metadata.task).toBeDefined();
      expect(result.data.createdNote.metadata.task.status).toBe('not_started');
    });

    it('should detect and prevent cycles', async () => {
      const noteA = await service.createNote({ title: 'A' });
      const noteB = await service.createNote({ title: 'B' });

      // A depends on B
      await service.addDependency(noteA.id, workspace.id, {
        existingNoteId: noteB.id,
        type: 'prerequisite',
      });

      // B depends on A (would create cycle)
      const result = await service.addDependency(noteB.id, workspace.id, {
        existingNoteId: noteA.id,
        type: 'prerequisite',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('circular');
    });

    it('should clean up created note if cycle detected', async () => {
      const noteA = await service.createNote({ title: 'A' });

      // A depends on new note B
      const resultB = await service.addDependency(noteA.id, workspace.id, {
        title: 'B',
        type: 'prerequisite',
      });
      const noteB = resultB.data.createdNote;

      // B depends on new note C that depends on A (cycle: A -> B -> C -> A)
      await service.addDependency(noteB.id, workspace.id, {
        title: 'C',
        type: 'prerequisite',
      });
      const noteC = resultC.data.createdNote;

      // C depends on A (would create cycle)
      const result = await service.addDependency(noteC.id, workspace.id, {
        existingNoteId: noteA.id,
        type: 'prerequisite',
      });

      expect(result.ok).toBe(false);
      // Note: We don't clean up C here because it already exists
      // Only clean up if we created it in THIS call
    });
  });
});

    await this.update(dependentId, {
      metadata: {
        ...dependent.metadata,
        dependents,
      },
    });
  }
}
```

**Key Points**:
- All task operations are methods on NotesService
- Graph queries traverse notes directly (no separate graph cache)
- Cycle detection uses DFS on-demand
- Dependent cache kept in sync automatically
- Status updates are automatic based on dependencies

## Event-Driven Updates

### Status Change Events

NotesService can emit events for reactive updates:

```typescript
class NotesService {
  private eventEmitter = new EventEmitter();

  async updateTaskStatus(
    noteId: NoteId,
    newStatus: TaskStatus
  ): Promise<Note> {
    const note = await this.get(noteId);
    const oldStatus = note?.metadata?.task?.status;

    // ... update logic ...

    // Emit event
    this.eventEmitter.emit('task:status-changed', {
      noteId,
      oldStatus,
      newStatus,
      timestamp: new Date().toISOString(),
    });

    return updatedNote;
  }

  on(event: string, handler: (data: any) => void): () => void {
    this.eventEmitter.on(event, handler);
    return () => this.eventEmitter.off(event, handler);
  }
}
```

### UI Reactivity

Components subscribe to events:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { notesService } from '$features/notes';

  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    unsubscribe = notesService.on('task:status-changed', (event) => {
      // Update UI
      console.log('Task status changed:', event);
      // Trigger re-render or update local state
    });
  });

  onDestroy(() => {
    unsubscribe?.();
  });
</script>
```

## Agent Collaboration Workflow

### The Prerequisite Pattern

The key workflow enabled by on-demand note creation:

```
Agent A working on "Implement user profiles":
1. Realizes authentication is needed first
2. Calls propose_prerequisite MCP tool:
   - currentTaskId: "user-profiles-note-id"
   - prerequisiteTitle: "Implement authentication"
   - prerequisiteDescription: "Add JWT-based auth with login/logout"
   - reason: "User profiles require authenticated users"
   - spawnAgent: true
   - agentType: "implement"

3. System (via addDependency):
   - Creates new note "Implement authentication"
   - Marks it as task with status='not_started', priority='high'
   - Links: user-profiles -> depends on -> authentication
   - Updates user-profiles status to 'blocked'
   - Emits 'note:agent-spawn-requested' event

4. Agent Service (Phase 3):
   - Listens for 'note:agent-spawn-requested' event
   - Spawns Agent B assigned to authentication note
   - Agent B reads acceptance criteria from note metadata
   - Agent B works on authentication

5. When Agent B completes:
   - Calls update_task_status(authentication, 'complete')
   - System automatically updates user-profiles status: 'blocked' -> 'ready'
   - Agent A can resume work

6. Agent A resumes:
   - Queries get_ready_tasks
   - Sees user-profiles is now ready
   - Continues implementation
```

### Benefits

- **Automatic coordination**: Agents don't need to manually track each other
- **Clear dependencies**: Graph structure makes relationships explicit
- **Status propagation**: Blocked/ready states update automatically
- **Audit trail**: All prerequisite creation is logged in note metadata
- **Flexible collaboration**: Agents can spawn sub-agents for prerequisites

## Integration Points

### 1. MCP Tools

Expose task operations to agents:

```typescript
// In task-tools.ts
export const proposePrerequisiteTool: IMCPTool = {
  name: 'propose_prerequisite',
  description: 'Propose a prerequisite task that must be completed before the current task. Creates a new task note and links it as a dependency.',
  inputSchema: {
    type: 'object',
    properties: {
      currentTaskId: { type: 'string', description: 'ID of the current task that has a prerequisite' },
      prerequisiteTitle: { type: 'string', description: 'Title of the prerequisite task' },
      prerequisiteDescription: { type: 'string', description: 'Description of what needs to be done' },
      reason: { type: 'string', description: 'Why this prerequisite is needed' },
      spawnAgent: { type: 'boolean', description: 'Whether to spawn a new agent to work on this prerequisite' },
      agentType: { type: 'string', description: 'Optional: Type of agent to spawn (e.g., "implement", "investigate")' },
    },
    required: ['currentTaskId', 'prerequisiteTitle', 'prerequisiteDescription'],
  },
  async execute(call: ToolCall): Promise<ToolResult> {
    const { currentTaskId, prerequisiteTitle, prerequisiteDescription, reason, spawnAgent, agentType } = call.arguments;

    const result = await notesService.addDependency(
      currentTaskId,
      workspaceId,
      {
        title: prerequisiteTitle,
        content: prerequisiteDescription,
        type: 'prerequisite',
        reason,
        spawnAgent: spawnAgent ? { agentType } : undefined,
      }
    );

    if (!result.ok) {
      return { error: result.error };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Created prerequisite task: ${result.data.createdNote.title}\nPrerequisite ID: ${result.data.createdNote.id}\nCurrent task is now blocked until prerequisite is complete.`
        }
      ]
    };
  }
};

export const markNoteAsTaskTool: IMCPTool = {
  name: 'mark_note_as_task',
  description: 'Convert a note into a task with status tracking',
  inputSchema: {
    type: 'object',
    properties: {
      noteId: { type: 'string', description: 'ID of the note' },
      status: { type: 'string', enum: ['not_started', 'in_progress'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      acceptanceCriteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of criteria for task completion'
      },
    },
    required: ['noteId'],
  },
  async execute(call: ToolCall): Promise<ToolResult> {
    const { noteId, ...taskData } = call.arguments;
    const note = await notesService.markAsTask(noteId, taskData);
    return {
      content: [{
        type: 'text',
        text: `Note "${note.title}" is now a task with status: ${note.metadata?.task?.status}`
      }],
    };
  },
};
```

### 2. UI Components

Task-aware note rendering:

```svelte
<!-- TaskNote.svelte -->
<script lang="ts">
  import type { Note } from '$shared/types';
  import TaskStatusBadge from './TaskStatusBadge.svelte';
  import TaskDependencies from './TaskDependencies.svelte';

  export let note: Note;

  $: isTask = !!note.metadata?.task;
  $: taskStatus = note.metadata?.task?.status;
</script>

{#if isTask}
  <div class="task-note">
    <div class="task-header">
      <h2>{note.title}</h2>
      <TaskStatusBadge status={taskStatus} />
    </div>

    <TaskDependencies
      dependencies={note.metadata?.dependencies || []}
      dependents={note.metadata?.dependents || []}
    />

    <div class="note-content">
      {@html note.content}
    </div>
  </div>
{:else}
  <div class="regular-note">
    <h2>{note.title}</h2>
    <div class="note-content">
      {@html note.content}
    </div>
  </div>
{/if}
```

### 3. Agent Rules

Task-aware agent behavior:

```markdown
# Task-Aware Agent Rules

When working on a note that has task metadata:

1. **Check Status**: Read `note.metadata.task.status` to understand current state
2. **Review Criteria**: Check `note.metadata.task.acceptanceCriteria` for goals
3. **Check Dependencies**: Verify all dependencies are complete before starting
4. **Update Status**: Use `update_task_status` tool to mark progress
5. **Propose Prerequisites**: If blocked, use `propose_prerequisite_task` to create dependencies

## Status Transitions

- `not_started` → `in_progress`: When you begin work
- `in_progress` → `complete`: When all acceptance criteria are met
- `in_progress` → `blocked`: When you discover a dependency
- `blocked` → `ready`: Automatic when dependencies complete
```

## Summary

This architecture provides:

1. **Flexibility**: Notes can be tasks or not, with smooth transitions
2. **Performance**: In-memory graph for fast queries, incremental updates
3. **Consistency**: Service layer ensures graph and notes stay in sync
4. **Reactivity**: Event-driven updates keep UI responsive
5. **Extensibility**: Easy to add new task features without breaking existing code

The key insight is that **task metadata is just another facet of notes**, not a separate entity. This keeps the data model simple while enabling powerful task management capabilities.
