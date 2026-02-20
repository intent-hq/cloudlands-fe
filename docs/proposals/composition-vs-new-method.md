# Composition vs. New Method: Analysis

**Date**: 2025-11-28
**Question**: Should we compose existing methods or create a new one?

---

## Existing Building Blocks

We already have these atomic operations:

1. **`createNote()`** - Create a note
2. **`markAsTask()`** - Add task metadata to a note
3. **`addDependency()`** - Link two notes with a dependency
4. **`assignAgentToTask()`** - Assign an existing agent to a task note

And these composite operations:

5. **`createPrerequisiteNote()`** - Orchestrates: createNote → markAsTask → addDependency
6. **`createTaskNoteAndAssignAgent()`** - Orchestrates: createNote → markAsTask → assignAgentToTask

---

## What We Need

A method that:
1. Creates a note
2. Marks it as a task
3. Optionally adds dependency to parent
4. **Creates a NEW agent** (not just assigns existing one)
5. Assigns that agent to the task
6. Builds initial message for agent
7. Optionally launches agent

---

## Option A: Composition (Orchestrator)

```typescript
async createTaskNoteAndLaunchAgent(
  workspaceId: WorkspaceId,
  options: {
    title: string;
    content?: string;
    parentNoteId?: NoteId;
    dependencyType?: DependencyType;
    taskStatus?: TaskStatus;
    launchAgent?: boolean;
    userInstruction?: string;
    model?: string;
  }
): Promise<Result<{ note: Note; agent?: AgentSession }, string>> {
  try {
    // Step 1: Create note with task metadata
    // Can we reuse createPrerequisiteNote if parentNoteId exists?
    let noteResult;
    if (options.parentNoteId) {
      // Use existing createPrerequisiteNote
      noteResult = await this.createPrerequisiteNote(
        workspaceId,
        options.parentNoteId,
        {
          title: options.title,
          content: options.content,
          dependencyType: options.dependencyType,
          taskStatus: options.taskStatus,
        }
      );
    } else {
      // Create note + mark as task manually
      const createResult = await this.createNote({
        workspaceId,
        title: options.title,
        content: options.content || '',
      });
      if (!createResult.ok) return createResult;

      noteResult = await this.markAsTask(
        workspaceId,
        createResult.data.id,
        { status: options.taskStatus || 'not_started' }
      );
    }

    if (!noteResult.ok) return noteResult;
    const note = noteResult.data;

    // Step 2: Create and assign agent (if requested)
    if (options.launchAgent) {
      // Build initial message
      const initialMessage = buildTaskAgentInitialMessage(
        note,
        options.userInstruction
      );

      // Create agent via UnifiedAgentCreator
      const workspace = await this.getWorkspace(workspaceId);
      const agentSession = await unifiedCreator.createAgent(workspace, {
        name: sanitizeAgentName(options.title),
        instruction: initialMessage,
        rules: taskLoopRules,
        model: options.model,
        metadata: {
          taskNoteId: note.id,
          agentType: 'task-loop',
        },
      });

      // Assign agent to task
      const assignResult = await this.assignAgentToTask(
        workspaceId,
        note.id,
        agentSession.id
      );

      if (!assignResult.ok) {
        // Agent created but assignment failed
        // Should we delete the agent? Or just log warning?
        logger.warn('Agent created but assignment failed', assignResult.error);
      }

      return {
        ok: true,
        data: { note: assignResult.ok ? assignResult.data : note, agent: agentSession },
      };
    }

    return { ok: true, data: { note } };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
```

### Pros of Composition
✅ **Reuses existing methods** - No duplication of note creation logic
✅ **Leverages existing rollback** - `createPrerequisiteNote` already handles rollback
✅ **Smaller method** - Just orchestrates existing pieces
✅ **Easier to test** - Can mock existing methods
✅ **Follows DRY principle** - Don't repeat note creation logic

### Cons of Composition
❌ **Conditional logic** - Different paths for with/without parent
❌ **Partial reuse** - Can't fully reuse `createPrerequisiteNote` (it doesn't know about agents)
❌ **Agent creation is new** - Still need to add UnifiedAgentCreator integration
❌ **Rollback complexity** - What if agent creation succeeds but assignment fails?
❌ **Dependency on NotesService** - Needs access to UnifiedAgentCreator (cross-service dependency)

---

## Option B: New Standalone Method

```typescript
async createTaskNoteAndLaunchAgent(
  workspaceId: WorkspaceId,
  options: { /* same as above */ }
): Promise<Result<{ note: Note; agent?: AgentSession }, string>> {
  try {
    // Step 1: Create note
    const createResult = await this.createNote({
      workspaceId,
      title: options.title,
      content: options.content || '',
    });
    if (!createResult.ok) return createResult;
    const note = createResult.data;

    // Step 2: Mark as task
    const taskResult = await this.markAsTask(workspaceId, note.id, {
      status: options.taskStatus || 'not_started',
    });
    if (!taskResult.ok) {
      await this.deleteNote(note.id, workspaceId);
      return taskResult;
    }

    // Step 3: Add dependency (if parent provided)
    if (options.parentNoteId) {
      const depResult = await this.addDependency(
        workspaceId,
        options.parentNoteId,
        {
          noteId: note.id,
          type: options.dependencyType || 'prerequisite',
        }
      );
      if (!depResult.ok) {
        await this.deleteNote(note.id, workspaceId);
        return depResult;
      }
    }

    // Step 4: Create and assign agent (if requested)
    if (options.launchAgent) {
      // ... same agent creation logic as Option A ...
    }

    return { ok: true, data: { note: taskResult.data, agent } };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
```

### Pros of Standalone
✅ **Single code path** - No conditional logic for with/without parent
✅ **Clear rollback** - Explicit rollback at each step
✅ **Self-contained** - All logic in one place
✅ **Easier to understand** - Linear flow, no jumping between methods

### Cons of Standalone
❌ **Duplicates logic** - Repeats the createNote → markAsTask → addDependency pattern
❌ **Longer method** - More lines of code
❌ **Maintenance burden** - Changes to note creation need to be made in multiple places
❌ **Still needs UnifiedAgentCreator** - Cross-service dependency remains

---

## The Real Question: Where Does Agent Creation Belong?

Both options face the same challenge: **NotesService needs to create agents**.

### Current Architecture
```
NotesService (features/notes/)
  ↓ needs
UnifiedAgentCreator (features/agent/)
```

This is a **cross-service dependency**. Options:

### 1. Accept the Dependency
- NotesService imports UnifiedAgentCreator
- **Pro**: Simple, direct
- **Con**: Tight coupling between services

### 2. Dependency Injection
- Pass UnifiedAgentCreator to NotesService constructor
- **Pro**: Testable, loosely coupled
- **Con**: More complex setup

### 3. Separate Orchestration Service
- Create `TaskAgentOrchestrator` that uses both services
- **Pro**: Clean separation of concerns
- **Con**: Another service to maintain

### 4. Keep Agent Creation in Caller
- NotesService only creates notes
- Caller (UI/MCP) creates agent and calls `assignAgentToTask`
- **Pro**: No cross-service dependency
- **Con**: Duplicated orchestration logic in multiple callers

---

## Recommendation

**Option A (Composition) + Dependency Injection**

```typescript
class NotesService {
  constructor(
    private repository: NotesRepository,
    private agentCreator?: UnifiedAgentCreator  // Optional for testing
  ) {}

  async createTaskNoteAndLaunchAgent(...) {
    // Reuse createPrerequisiteNote when possible
    // Create agent via this.agentCreator if provided
    // Graceful degradation if agentCreator not available
  }
}
```

### Why This Approach?

1. **Reuses existing methods** - Leverages `createPrerequisiteNote` when parent exists
2. **Testable** - Can mock agentCreator in tests
3. **Graceful degradation** - Works without agentCreator (just creates note)
4. **Smaller method** - Orchestrates rather than duplicates
5. **Follows existing patterns** - Similar to how `createPrerequisiteNote` orchestrates

### Downsides to Accept

1. **Conditional logic** - Different paths for with/without parent (but minimal)
2. **Cross-service dependency** - NotesService depends on AgentCreator (but injected)
3. **Rollback complexity** - Need to handle agent creation failures (but manageable)

---

## Alternative: Keep It Simple

**Don't create this method at all.** Instead:

1. **For MCP tools**: Enhance `createPrerequisiteNote` to accept optional `agentConfig`
2. **For UI**: Create orchestration in the component/IPC handler
3. **For checklist items**: Same as UI

This keeps services focused and moves orchestration to the edges.

### Pros
✅ Services stay simple and focused
✅ No cross-service dependencies
✅ Flexibility at the edges

### Cons
❌ Duplicated orchestration logic in multiple places
❌ Harder to ensure consistent behavior
❌ More code in UI/MCP layers

---

## My Recommendation

**Go with composition + dependency injection**, but keep it **minimal**:

```typescript
// Enhance existing createPrerequisiteNote with optional agent config
async createPrerequisiteNote(
  workspaceId: WorkspaceId,
  dependentNoteId: NoteId,
  options: {
    title: string;
    content?: string;
    dependencyType?: DependencyType;
    taskStatus?: TaskStatus;
    agentConfig?: {  // NEW: Optional agent creation
      instruction?: string;
      model?: string;
    };
  }
): Promise<Result<{ note: Note; agent?: AgentSession }, string>>
```

This:
- ✅ Reuses existing method
- ✅ Minimal changes
- ✅ Backward compatible (agentConfig is optional)
- ✅ Handles the most common case (creating prerequisite with agent)
- ✅ For non-prerequisite cases, callers can orchestrate manually

**For the other touchpoints** (TaskMetadataBar, checklist items without parent), they can orchestrate manually or we add a simpler `createTaskNote` that doesn't assume a parent.
