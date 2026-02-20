# Learnings from `tchu-task-note-rendering` Branch

**Date**: 2025-11-28
**Branch**: `tchu-task-note-rendering`
**Context**: Previous iteration where tasks were first-class objects (abandoned in favor of tasks-as-metadata)

---

## Key Insight

The `tchu-task-note-rendering` branch got **very far with the UX** for agent assignment to tasks. Even though we abandoned the first-class Task object approach, the **UI patterns and component architecture are still highly relevant** for our current work.

---

## 🎯 Most Relevant Component: TaskAgentAssignmentInput

### What It Does
A self-contained component for assigning agents to tasks with a **rich, always-visible input** that:
- Shows rich input with @ mentions, model picker, context items
- Manages full flow from input → agent creation → success state
- Supports **multiple agents per task** (input resets after each assignment)
- Auto-launches agents with initial message
- Shows brief success state, then resets for next agent

### Key UX Patterns

#### 1. **Always-Visible Input** (Not Hidden Behind Button)
```svelte
<!-- Input is ALWAYS visible, not behind a toggle -->
<SimpleRichInput
  bind:value={instruction}
  bind:contextItems
  placeholder="Additional instructions for agent (optional)..."
  onsubmit={handleAssign}
/>
```

**Why This Matters**: Aligns with user preference for "input components to be always visible rather than hidden behind toggle buttons"

#### 2. **Three-State Component**
```typescript
type AssignmentState = "input" | "assigning" | "success";

// Input → Assigning (spinner) → Success (2s) → Reset to Input
```

**Why This Matters**: Clear feedback loop, encourages multiple agent assignments

#### 3. **Rich Initial Message Builder**
```typescript
function buildInitialMessage(userInstruction: string): string {
  return `
You have been assigned a task. Your task note has been pre-created for you.

**Your context:**
- Task ID: ${task.id}
- Task Note ID: ${task.noteId}
- Task text: "${task.name}"

**Additional instructions from user:**
${userInstruction}

**First, read your context:**
1. Read your task note using notes.get("${task.noteId}")
2. Read your task metadata using tasks.get("${task.id}")

**Then, follow the task-loop workflow:**
- Fill in the Hypothesized Acceptance Criteria section
- Add initial References
- Update task status to "in_progress"
- Communicate your understanding and proposed approach

**Remember:** Update the task note at the end of EVERY turn.
  `;
}
```

**Why This Matters**: Provides clear onboarding for agents, sets expectations

#### 4. **Context References Integration**
```typescript
function buildContextReferences() {
  return [
    {
      type: "task",
      content: task.name,
      metadata: {
        taskId: task.id,
        taskNoteId: task.noteId,
      },
    },
    // Add any additional context items from the rich input
    ...contextItems.map((item) => ({
      type: item.type,
      content: item.content || item.label,
      metadata: item.metadata,
    })),
  ];
}
```

**Why This Matters**: Agents get full context about the task

---

## 🏗️ Architecture Pattern: Unified Task-Agent Creation

### The Problem They Solved
Task-agent creation logic was duplicated across:
- Frontend UI components
- MCP tools
- IPC handlers

### The Solution
**Extend TasksService with agent creation methods** rather than creating separate service:

```typescript
// In TasksService
async createPrerequisiteTask(
  workspaceId: string,
  parentTaskId: string,
  options: {
    name: string;
    description: string;
    launchAgent?: boolean;      // Optional agent creation
    userInstruction?: string;   // For agent initial message
    model?: string;             // For agent model selection
  }
): Promise<Result<{
  prerequisiteTask: Task;
  parentTask: Task;
  agent?: AgentRecord;          // Optional agent info
}, string>>
```

### Key Design Decisions

1. **Optional `launchAgent` Parameter**
   - Minimal API surface (no method explosion)
   - Backward compatible
   - Flexible (can add agent to any task creation operation)

2. **Graceful Degradation**
   - If agent creation fails, task creation still succeeds
   - Task creation is primary operation
   - Agent creation is enhancement

3. **Shared Utilities**
   - `provider-inference.ts` - Infer provider from model
   - `agent-name-sanitizer.ts` - Sanitize agent names
   - Message builder utilities
   - Rules loader utilities

---

## 📋 What We Should Adopt for Current Work

### 1. TaskAgentAssignmentInput Component (High Priority)

**Adapt for TaskMetadataBar:**
```svelte
<!-- In TaskMetadataBar.svelte -->
{#if note.metadata?.task}
  <div class="task-agent-section">
    <!-- Show assigned agents -->
    {#if note.metadata.task.assignedAgentIds?.length > 0}
      <div class="assigned-agents">
        {#each note.metadata.task.assignedAgentIds as agentId}
          <AgentChip {agentId} />
        {/each}
      </div>
    {/if}

    <!-- Always-visible input for assigning new agents -->
    <TaskAgentAssignmentInput
      taskNoteId={note.id}
      {workspace}
      onAgentAssigned={handleAgentAssigned}
    />
  </div>
{/if}
```

### 2. Initial Message Builder Pattern

**Create utility for our system:**
```typescript
// src/features/notes/utils/task-agent-message-builder.ts
export function buildTaskAgentInitialMessage(
  note: Note,
  userInstruction?: string
): string {
  return `
You have been assigned to work on a task note.

**Your task note:**
- Note ID: ${note.id}
- Title: ${note.title}
- Status: ${note.metadata?.task?.status}

**Your context:**
${note.content}

${userInstruction ? `\n**Additional instructions:**\n${userInstruction}` : ''}

**First steps:**
1. Read your task note using get_my_task("${note.id}")
2. Review any dependencies
3. Update status to "in_progress" if starting work
4. Communicate your understanding and approach

**Remember:** Update the task note regularly with your progress.
  `;
}
```

### 3. Unified Agent Creation Pattern

**For our current system:**
```typescript
// In NotesService or new TaskAgentService
async assignAgentToTaskWithLaunch(
  workspaceId: WorkspaceId,
  noteId: NoteId,
  options: {
    userInstruction?: string;
    model?: string;
    autoLaunch?: boolean;  // Whether to start agent immediately
  }
): Promise<Result<{ note: Note; agent?: AgentSession }, string>> {
  // 1. Verify note is a task
  // 2. Create agent via UnifiedAgentCreator
  // 3. Assign agent to task (assignAgentToTask)
  // 4. Optionally launch agent with initial message
  // 5. Return both note and agent info
}
```

---

## 🚫 What We Should NOT Adopt

### 1. First-Class Task Objects
- We decided tasks are metadata on notes, not separate entities
- Keep current approach

### 2. Separate TasksService
- We're using NotesService with task metadata
- Don't create separate service

### 3. Task-Specific MCP Tools (Maybe)
- They had `list_tasks`, `get_task`, `update_task`
- We have `get_my_task`, `mark_as_task`, etc.
- Our approach is more note-centric (better fit)

---

## 🎯 Recommended Next Steps

### Phase 1: UI Component (2-3 hours)
1. Create `TaskAgentAssignmentInput.svelte` adapted for our system
2. Integrate into `TaskMetadataBar.svelte`
3. Show assigned agents with chips/badges
4. Always-visible input for new assignments

### Phase 2: Message Builder Utility (1 hour)
1. Create `task-agent-message-builder.ts`
2. Build rich initial messages for agents
3. Include task context, dependencies, instructions

### Phase 3: Unified Creation Method (2 hours)
1. Add `assignAgentToTaskWithLaunch()` to NotesService
2. Integrate with UnifiedAgentCreator
3. Support auto-launch option
4. Return both note and agent info

### Phase 4: Testing (1 hour)
1. Test UI component with real tasks
2. Test agent creation flow
3. Test multiple agents per task
4. Test with dependencies

---

## 📝 Key Takeaways

1. **Always-visible input** is the right UX pattern (not hidden behind button)
2. **Three-state component** (input → assigning → success) provides clear feedback
3. **Rich initial messages** help agents understand their task context
4. **Unified creation methods** prevent code duplication
5. **Graceful degradation** (task creation succeeds even if agent fails)
6. **Context references** give agents full task context

The `tchu-task-note-rendering` branch solved many UX and architecture problems we're facing now. We should adopt the UI patterns and component architecture while keeping our simpler tasks-as-metadata approach.
