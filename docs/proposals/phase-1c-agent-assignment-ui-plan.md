# Phase 1C: Agent Assignment UI Implementation Plan

**Date**: 2025-11-28
**Status**: 🔄 READY TO START
**Priority**: High
**Estimated Effort**: 3-4 hours

---

## Context

Phase 1C backend is **mostly complete**:
- ✅ Data model (`assignedAgentIds[]` in TaskMetadata)
- ✅ Service layer (`assignAgentToTask`, `createTaskNoteAndAssignAgent`)
- ✅ IPC layer (2 channels registered)
- ✅ MCP tools (agents can assign themselves/others)
- ✅ 22 tests passing for agent assignment

**What's Missing**: UI to show and manage agent assignments in TaskMetadataBar

---

## Goal

Add UI to TaskMetadataBar that:
1. Shows which agents are assigned to a task
2. Provides always-visible input to assign new agents
3. Supports multiple agents per task
4. Auto-launches agents with rich initial message
5. Follows patterns from `tchu-task-note-rendering` branch

---

## Design

### Visual Layout

```
┌─────────────────────────────────────────────────────┐
│ Task Metadata Bar                                   │
├─────────────────────────────────────────────────────┤
│ Status: In Progress                                 │
│                                                     │
│ Dependencies (2) ▼                                  │
│   • Setup Environment (prerequisite)                │
│   • Install Dependencies (prerequisite)             │
│                                                     │
│ Assigned Agents (2) ▼                               │
│   [🤖 Agent-1] [🤖 Agent-2]                         │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ Assign new agent...                         │   │
│ │ [Rich input with @ mentions, model picker]  │   │
│ └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Component Structure

```
TaskMetadataBar.svelte
├── Status section (existing)
├── Dependencies section (existing)
└── Agent Assignment section (NEW)
    ├── AssignedAgentsList (NEW)
    │   └── AgentChip × N (clickable, opens chat)
    └── TaskAgentAssignmentInput (NEW)
        └── SimpleRichInput (reuse existing)
```

---

## Implementation Plan

### Step 1: Create AssignedAgentsList Component (30 min)

**File**: `src/lib/components/workspace/AssignedAgentsList.svelte`

```svelte
<script lang="ts">
  import type { AgentId } from '$shared/types';
  import AgentChip from './AgentChip.svelte';

  interface Props {
    agentIds: AgentId[];
    onAgentClick?: (agentId: AgentId) => void;
  }

  let { agentIds, onAgentClick }: Props = $props();
</script>

{#if agentIds.length > 0}
  <div class="assigned-agents">
    <div class="text-xs font-medium text-muted-foreground mb-2">
      Assigned Agents ({agentIds.length})
    </div>
    <div class="flex flex-wrap gap-2">
      {#each agentIds as agentId}
        <AgentChip {agentId} onClick={() => onAgentClick?.(agentId)} />
      {/each}
    </div>
  </div>
{/if}
```

### Step 2: Create AgentChip Component (30 min)

**File**: `src/lib/components/workspace/AgentChip.svelte`

```svelte
<script lang="ts">
  import type { AgentId } from '$shared/types';
  import { agentStore } from '$lib/stores/agent.store.svelte';
  import Fa from 'svelte-fa';
  import { faRobot } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    agentId: AgentId;
    onClick?: () => void;
  }

  let { agentId, onClick }: Props = $props();

  // Get agent from store
  let agent = $derived(agentStore.getAgent(agentId));
  let agentName = $derived(agent?.session?.name || 'Agent');
  let agentStatus = $derived(agent?.session?.status || 'unknown');
</script>

<button
  class="agent-chip"
  class:active={agentStatus === 'active'}
  class:complete={agentStatus === 'complete'}
  onclick={onClick}
>
  <Fa icon={faRobot} class="w-3 h-3" />
  <span class="text-xs">{agentName}</span>
</button>

<style>
  .agent-chip {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border);
    background: var(--background);
    cursor: pointer;
    transition: all 0.2s;
  }

  .agent-chip:hover {
    background: var(--muted);
  }

  .agent-chip.active {
    border-color: var(--primary);
    background: var(--primary-foreground);
  }

  .agent-chip.complete {
    opacity: 0.6;
  }
</style>
```

### Step 3: Create TaskAgentAssignmentInput Component (1.5 hours)

**File**: `src/lib/components/workspace/TaskAgentAssignmentInput.svelte`

Adapt from `tchu-task-note-rendering` branch with these changes:
- Use `noteId` instead of `taskId` (tasks are metadata on notes)
- Call `assignAgentToTask` + `UnifiedAgentCreator` instead of `createPrerequisiteTask`
- Build initial message using task note content
- Include task metadata in context references

**Key Features**:
- Always-visible rich input
- Three states: input → assigning → success
- Auto-reset after 2 seconds
- Support @ mentions, model picker, context items
- Build rich initial message for agent

### Step 4: Integrate into TaskMetadataBar (1 hour)

**File**: `src/lib/components/workspace/TaskMetadataBar.svelte`

Add new section after dependencies:

```svelte
<!-- Agent Assignment Section -->
{#if note.metadata?.task}
  <div class="agent-assignment-section mt-4">
    <!-- Show assigned agents -->
    <AssignedAgentsList
      agentIds={note.metadata.task.assignedAgentIds || []}
      onAgentClick={handleAgentClick}
    />

    <!-- Always-visible input for new assignments -->
    <div class="mt-3">
      <TaskAgentAssignmentInput
        noteId={note.id}
        {workspace}
        onAgentAssigned={handleAgentAssigned}
      />
    </div>
  </div>
{/if}
```

### Step 5: Create Message Builder Utility (30 min)

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

---

## Testing Plan

### Manual Testing
1. Open a task note in TaskMetadataBar
2. Verify "Assigned Agents" section appears (empty initially)
3. Type instruction in input, select model
4. Click send → verify agent created and assigned
5. Verify agent chip appears in list
6. Click agent chip → verify navigates to chat
7. Assign second agent → verify both chips show
8. Verify input resets after each assignment

### Integration Testing
1. Create task note via UI
2. Assign agent via UI
3. Verify `assignedAgentIds` in note metadata
4. Verify agent can read task via `get_my_task`
5. Verify agent sees dependencies

---

## Success Criteria

- [ ] AssignedAgentsList component created and working
- [ ] AgentChip component created and working
- [ ] TaskAgentAssignmentInput component created and working
- [ ] Message builder utility created and tested
- [ ] TaskMetadataBar shows assigned agents
- [ ] TaskMetadataBar has always-visible input for new assignments
- [ ] Multiple agents can be assigned to same task
- [ ] Clicking agent chip navigates to chat
- [ ] Input resets after successful assignment
- [ ] Rich initial message sent to agent
- [ ] Manual testing passes

---

## Files to Create/Modify

**New Files:**
- `src/lib/components/workspace/AssignedAgentsList.svelte`
- `src/lib/components/workspace/AgentChip.svelte`
- `src/lib/components/workspace/TaskAgentAssignmentInput.svelte`
- `src/features/notes/utils/task-agent-message-builder.ts`

**Modified Files:**
- `src/lib/components/workspace/TaskMetadataBar.svelte`

---

## Next Steps After This

Once UI is complete, Phase 1C will be fully done. Then we can move to:
- **Phase 1D**: Agent collaboration (agents spawning other agents)
- **Phase 2**: Task completion notifications
- **Phase 3**: Integration tests for full workflow
