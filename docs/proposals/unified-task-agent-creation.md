# Unified Task-Agent Creation

**Date**: 2025-11-28
**Status**: 🎯 PRIORITY - Do This First
**Estimated Effort**: 2-3 hours

---

## Linked Checklist Item Representation

### Design Decisions (2025-12-02)

When a checklist item is delegated to a Task Note, the markdown representation is:

```markdown
- [ ] [delegated](intent://local/task/{noteId})
```

**Key Decisions:**

| Aspect | Decision |
|--------|----------|
| URL format | `intent://local/task/{noteId}` (not `/note/`) |
| Link text | `delegated` (fixed placeholder, not the title) |
| Display text source | Task Note's `title` (fetched at render time) |
| Status source of truth | Task Note's `metadata.task.status` |
| Checkbox state in markdown | Ignored for linked tasks |

**Distinguishing from normal links:**
- `intent://local/note/{id}` = Regular note link (renders as clickable link)
- `intent://local/task/{id}` = Delegated task (renders in linked task mode)

### Status Mapping

```
Task Note Status     →  Checkbox Visual
─────────────────────────────────────────
proposed             →  ☐ unchecked
not_started          →  ☐ unchecked
blocked              →  ☐ unchecked
ready                →  ☐ unchecked
in_progress          →  ◐ indeterminate
complete             →  ☑ checked
cancelled            →  ☐ unchecked (strikethrough later)
```

### Checkbox Interaction

When user clicks checkbox on a linked task, it cycles through and updates the Task Note:
- unchecked → `in_progress`
- indeterminate → `complete`
- checked → `not_started`

### Visual Treatment

- Add CSS class `linked-task` for styling (implemented later)
- Add "Open Note" button/badge on right side of the task item bar
- The display shows the Task Note's title (not the `[delegated]` text)

### Error State

If the Task Note doesn't exist (deleted or invalid link):
- Show "Not found" placeholder text
- Do not fall back to normal checkbox behavior

---

## Problem Statement

We have **three UX touchpoints** that all need to do the same thing:

1. **CustomTaskItemView** (checklist items) - "Delegate to agent" button
2. **TaskMetadataBar** (task notes) - TaskAgentAssignmentInput component
3. **MCP Tools** (agent chat) - `create_prerequisite` tool

Currently:
- ❌ Each has different code paths
- ❌ MCP tool only creates note, doesn't launch agent
- ❌ UI components don't have unified creation method
- ❌ No shared message builder for agent initial messages

**We need**: One unified operation that all three can use.

---

## Solution: Unified Service Method

### New Method in NotesService

```typescript
/**
 * Create a task note and optionally launch an agent to work on it.
 * This is the unified method used by UI, IPC, and MCP tools.
 */
async createTaskNoteAndLaunchAgent(
  workspaceId: WorkspaceId,
  options: {
    // Note creation
    title: string;
    content?: string;

    // Dependency linking (optional)
    parentNoteId?: NoteId;
    dependencyType?: DependencyType;  // 'prerequisite' | 'blocks' | 'related'

    // Task metadata
    taskStatus?: TaskStatus;

    // Agent creation (optional)
    launchAgent?: boolean;
    agentName?: string;
    userInstruction?: string;
    model?: string;
    autoStart?: boolean;  // Whether to send initial message immediately
  }
): Promise<Result<{
  note: Note;
  agent?: AgentSession;
}, string>>
```

### Implementation Steps

1. **Create note with task metadata**
   ```typescript
   const noteResult = await this.createNote(workspaceId, {
     title: options.title,
     content: options.content || '',
     metadata: {
       task: {
         status: options.taskStatus || 'not_started',
         assignedAgentIds: [],
       },
     },
   });
   ```

2. **Add dependency if parent provided**
   ```typescript
   if (options.parentNoteId) {
     await this.addDependency(workspaceId, {
       noteId: noteResult.data.id,
       dependsOnNoteId: options.parentNoteId,
       type: options.dependencyType || 'prerequisite',
     });
   }
   ```

3. **Create and assign agent if requested**
   ```typescript
   if (options.launchAgent) {
     // Build initial message
     const initialMessage = buildTaskAgentInitialMessage(
       noteResult.data,
       options.userInstruction
     );

     // Create agent via UnifiedAgentCreator
     const agentSession = await unifiedCreator.createAgent(workspace, {
       name: options.agentName || sanitizeAgentName(options.title),
       instruction: initialMessage,
       rules: taskLoopRules,
       model: options.model,
       metadata: {
         source: 'task-creation',
         agentType: 'task-loop',
         taskNoteId: noteResult.data.id,
       },
     });

     // Assign agent to task
     await this.assignAgentToTask(workspaceId, noteResult.data.id, agentSession.id);

     return { note: noteResult.data, agent: agentSession };
   }
   ```

4. **Graceful degradation**
   - If agent creation fails, task creation still succeeds
   - Log warning but don't fail entire operation

---

## Shared Utilities

### 1. Message Builder

**File**: `src/features/notes/utils/task-agent-message-builder.ts`

```typescript
export function buildTaskAgentInitialMessage(
  note: Note,
  userInstruction?: string
): string {
  const task = note.metadata?.task;
  const dependencies = note.metadata?.dependencies || [];

  const parts = [
    `You have been assigned to work on a task note.`,
    ``,
    `**Your task:**`,
    `- Note ID: ${note.id}`,
    `- Title: ${note.title}`,
    `- Status: ${task?.status || 'not_started'}`,
  ];

  if (dependencies.length > 0) {
    parts.push(
      ``,
      `**Dependencies (${dependencies.length}):**`,
      ...dependencies.map(d => `  - ${d.noteId} (${d.type})`),
    );
  }

  parts.push(
    ``,
    `**Task content:**`,
    note.content || '(no content)',
  );

  if (userInstruction) {
    parts.push(
      ``,
      `**Additional instructions:**`,
      userInstruction,
    );
  }

  parts.push(
    ``,
    `**First steps:**`,
    `1. Read your task note: get_my_task("${note.id}")`,
    `2. Review dependencies and acceptance criteria`,
    `3. Update status to "in_progress" if starting work`,
    `4. Communicate your understanding and approach`,
    ``,
    `**Remember:** Update the task note regularly with your progress.`,
  );

  return parts.join('\n');
}
```

### 2. Agent Name Sanitizer

**File**: `src/features/agent/utils/agent-name-sanitizer.ts`

```typescript
export function sanitizeAgentName(name: string): string {
  // Replace invalid characters with hyphens
  return name.replace(/[^a-zA-Z0-9\s\-_]/g, '-').trim();
}

export function generateAgentNameFromTask(taskTitle: string): string {
  // Take first 50 chars, sanitize, add "Agent" suffix
  const truncated = taskTitle.slice(0, 50);
  const sanitized = sanitizeAgentName(truncated);
  return `${sanitized}-Agent`;
}
```

---

## Integration Points

### 1. CustomTaskItemView (Checklist Items)

**Current**: Dispatches `task-delegate` event
**New**: Call unified method via IPC

```typescript
async function handleDelegate() {
  const result = await invoke('notes:create-task-and-launch-agent', {
    workspaceId: workspace.id,
    title: taskText(),
    content: `Task delegated from checklist item`,
    parentNoteId: currentNoteId,  // Link to parent note
    dependencyType: 'related',
    launchAgent: true,
    autoStart: true,
  });

  if (result.ok) {
    // Update task item with agent ID
    updateAttributes({ delegatedAgentId: result.data.agent.id });
  }
}
```

### 2. TaskMetadataBar (Task Notes)

**Current**: Not implemented
**New**: TaskAgentAssignmentInput calls unified method

```svelte
<script>
  async function handleAssign() {
    const result = await invoke('notes:create-task-and-launch-agent', {
      workspaceId: workspace.id,
      title: note.title,
      content: note.content,
      launchAgent: true,
      userInstruction: instruction,
      model: selectedModel,
      autoStart: true,
    });

    if (result.ok && result.data.agent) {
      onAgentLaunched?.(result.data.agent);
    }
  }
</script>
```

Wait, this doesn't make sense - we're creating a NEW note when we already have one!

**Actually for TaskMetadataBar**: Just assign agent to existing note

```typescript
// For existing task notes, use simpler method:
async assignAgentAndLaunch(
  workspaceId: WorkspaceId,
  noteId: NoteId,
  options: {
    userInstruction?: string;
    model?: string;
    autoStart?: boolean;
  }
): Promise<Result<AgentSession, string>>
```

### 3. MCP Tools (Agent Chat)

**Current**: `create_prerequisite` only creates note
**New**: Add `launchAgent` parameter

```typescript
// In CreatePrerequisiteTool.execute()
const result = await this.protocolAdapter.createTaskNoteAndLaunchAgent(
  this.workspaceId,
  {
    title,
    content,
    parentNoteId: dependentNoteId,
    dependencyType: 'prerequisite',
    taskStatus: status,
    launchAgent: true,  // NEW: Enable agent creation
    autoStart: false,   // Don't auto-start from MCP (let user control)
  }
);
```

---

## Implementation Order

### Phase 1: Core Service Method (1 hour)
1. Create `task-agent-message-builder.ts` utility
2. Create `agent-name-sanitizer.ts` utility (if doesn't exist)
3. Add `createTaskNoteAndLaunchAgent()` to NotesService
4. Add tests

### Phase 2: IPC Layer (30 min)
1. Add IPC handler for `notes:create-task-and-launch-agent`
2. Add client method
3. Test from renderer

### Phase 3: MCP Tool Enhancement (30 min)
1. Update `CreatePrerequisiteTool` to use new method
2. Add `launchAgent` parameter to tool schema
3. Update tests

### Phase 4: UI Integration (Later)
1. Update CustomTaskItemView to use new IPC method
2. Create TaskAgentAssignmentInput component
3. Integrate into TaskMetadataBar

---

## Success Criteria

- [ ] `createTaskNoteAndLaunchAgent()` method implemented and tested
- [ ] Message builder utility created and tested
- [ ] IPC handler and client method working
- [ ] MCP tool updated to support agent launching
- [ ] All existing tests still passing
- [ ] Can create task + launch agent from MCP tool
- [ ] Can create task + launch agent from UI (via IPC)

---

## Benefits

1. **Single Source of Truth** - One method for all task-agent creation
2. **Consistent Behavior** - Same logic regardless of entry point
3. **Easy to Test** - Business logic isolated in service layer
4. **Flexible** - Optional agent creation, optional auto-start
5. **Maintainable** - Changes only needed in one place
6. **Graceful Degradation** - Task succeeds even if agent fails

---

## Next Steps After This

Once unified creation is working:
1. Build UI components (TaskAgentAssignmentInput, etc.)
2. Add agent spawning from MCP (agents creating other agents)
3. Add task completion notifications
4. Integration tests for full workflow
