# Implementation Plan: Enhance createPrerequisiteNote with Agent Creation

**Date**: 2025-11-28
**Status**: 🎯 READY TO IMPLEMENT
**Estimated Effort**: 2-3 hours
**Decision**: Option 1 - Enhance existing method with optional agent config

---

## Goal

Enhance `createPrerequisiteNote()` to optionally create and assign an agent, enabling all three UX touchpoints to use the same code path:
1. MCP tools (agents creating prerequisites with agents)
2. TaskMetadataBar (assigning agents to task notes)
3. CustomTaskItemView (delegating checklist items to agents)

---

## Implementation Steps

### Step 1: Create Shared Utilities (30 min)

#### 1.1 Task Agent Message Builder

**File**: `src/features/notes/utils/task-agent-message-builder.ts`

```typescript
import type { Note } from '$shared/types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('TaskAgentMessageBuilder');

/**
 * Build initial message for an agent assigned to a task note
 */
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

**Tests**: `src/features/notes/utils/__tests__/task-agent-message-builder.test.ts`

#### 1.2 Agent Name Sanitizer (if doesn't exist)

**File**: `src/features/agent/utils/agent-name-sanitizer.ts`

```typescript
/**
 * Sanitize agent name to comply with validation pattern
 */
export function sanitizeAgentName(name: string): string {
  // Replace invalid characters with hyphens
  return name.replace(/[^a-zA-Z0-9\s\-_]/g, '-').trim();
}

/**
 * Generate agent name from task title
 */
export function generateAgentNameFromTask(taskTitle: string): string {
  const truncated = taskTitle.slice(0, 50);
  const sanitized = sanitizeAgentName(truncated);
  return `${sanitized}-Agent`;
}
```

**Tests**: `src/features/agent/utils/__tests__/agent-name-sanitizer.test.ts`

---

### Step 2: Enhance NotesService (1 hour)

#### 2.1 Add UnifiedAgentCreator Dependency

**File**: `src/features/notes/notes.service.ts`

```typescript
import { UnifiedAgentCreator } from '$features/agent/services/unified-agent-creator';
import { buildTaskAgentInitialMessage } from './utils/task-agent-message-builder';
import { generateAgentNameFromTask } from '$features/agent/utils/agent-name-sanitizer';

export class NotesService {
  constructor(
    private repository: NotesRepository,
    private agentCreator?: UnifiedAgentCreator  // Optional for testing
  ) {}

  // ... existing methods ...
}
```

#### 2.2 Enhance createPrerequisiteNote Method

**Location**: Line ~1487 in `notes.service.ts`

**Changes**:
1. Add `agentConfig` to options parameter
2. After creating note and adding dependency, create agent if requested
3. Assign agent to task
4. Return both note and agent in result
5. Handle agent creation failures gracefully

```typescript
async createPrerequisiteNote(
  workspaceId: WorkspaceId,
  dependentNoteId: NoteId,
  options: {
    title: string;
    content?: string;
    dependencyType?: DependencyType;
    reason?: string;
    taskStatus?: TaskStatus;
    agentConfig?: {  // NEW
      instruction?: string;
      model?: string;
      autoStart?: boolean;
    };
  }
): Promise<Result<{ note: Note; agent?: AgentSession }, string>> {
  try {
    // ... existing logic for creating note, marking as task, adding dependency ...

    // NEW: Create and assign agent if requested
    let agentSession: AgentSession | undefined;

    if (options.agentConfig && this.agentCreator) {
      try {
        // Build initial message
        const initialMessage = buildTaskAgentInitialMessage(
          taskNote,
          options.agentConfig.instruction
        );

        // Get workspace
        const workspaceResult = await this.repository.getWorkspace(workspaceId);
        if (!workspaceResult.ok) {
          logger.warn('Could not get workspace for agent creation', workspaceResult.error);
        } else {
          // Create agent
          const agentName = generateAgentNameFromTask(options.title);
          agentSession = await this.agentCreator.createAgent(workspaceResult.data, {
            name: agentName,
            instruction: initialMessage,
            rules: 'task-loop.md',  // Load from resources/agent-rules/
            model: options.agentConfig.model,
            metadata: {
              source: 'task-creation',
              agentType: 'task-loop',
              taskNoteId: taskNote.id,
            },
          });

          // Assign agent to task
          const assignResult = await this.assignAgentToTask(
            workspaceId,
            taskNote.id,
            agentSession.id
          );

          if (!assignResult.ok) {
            logger.warn('Agent created but assignment failed', assignResult.error);
            // Don't fail entire operation - agent exists, user can assign manually
          } else {
            // Update taskNote with assigned agent
            taskNote = assignResult.data;
          }

          logger.info('Agent created and assigned to task', {
            noteId: taskNote.id,
            agentId: agentSession.id,
          });
        }
      } catch (error) {
        // Graceful degradation - log warning but don't fail
        logger.warn('Failed to create agent for task', error);
        // Task creation succeeded, agent creation failed - acceptable
      }
    }

    return {
      ok: true,
      data: { note: taskNote, agent: agentSession },
    };
  } catch (error) {
    logger.error('Error creating prerequisite note', error);
    return { ok: false, error: `Failed to create prerequisite note: ${error}` };
  }
}
```

**Key Design Decisions**:
- ✅ Agent creation is **optional** (backward compatible)
- ✅ Agent creation failures are **non-fatal** (graceful degradation)
- ✅ UnifiedAgentCreator is **optional dependency** (testable)
- ✅ Returns both note and agent (caller knows what happened)

---

### Step 3: Update IPC Layer (15 min)

**File**: `src/features/notes/notes.ipc.ts`

Add new parameter to existing handler:

```typescript
ipcMain.handle('notes:create-prerequisite', async (event, args) => {
  const { workspaceId, dependentNoteId, options } = args;
  return await notesService.createPrerequisiteNote(
    workspaceId,
    dependentNoteId,
    options  // Now includes optional agentConfig
  );
});
```

**File**: `src/features/notes/notes.client.ts`

Update client method signature:

```typescript
async createPrerequisiteNote(
  workspaceId: WorkspaceId,
  dependentNoteId: NoteId,
  options: {
    title: string;
    content?: string;
    dependencyType?: DependencyType;
    reason?: string;
    taskStatus?: TaskStatus;
    agentConfig?: {
      instruction?: string;
      model?: string;
      autoStart?: boolean;
    };
  }
): Promise<Result<{ note: Note; agent?: AgentSession }, string>> {
  return invoke('notes:create-prerequisite', {
    workspaceId,
    dependentNoteId,
    options,
  });
}
```

---

### Step 4: Update MCP Tool (15 min)

**File**: `src/features/mcp/mcp/task-tools.ts`

Enhance `CreatePrerequisiteTool`:

```typescript
export class CreatePrerequisiteTool extends BaseMCPTool {
  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string) {
    super(
      'create_prerequisite',
      'Create a new prerequisite task note and optionally launch an agent to work on it.',
      createInputSchema(
        {
          dependentNoteId: stringProperty('The ID of the task that depends on this prerequisite'),
          title: stringProperty('Title for the new prerequisite task'),
          content: stringProperty('Content/description for the prerequisite task (optional)'),
          status: stringProperty('Initial status for the prerequisite', {
            enum: ['not_started', 'in_progress'],
            default: 'not_started',
          }),
          launchAgent: booleanProperty('Whether to create and assign an agent to this task', {  // NEW
            default: false,
          }),
          agentInstruction: stringProperty('Additional instructions for the agent (optional)'),  // NEW
          agentModel: stringProperty('Model for the agent (optional)'),  // NEW
        },
        ['dependentNoteId', 'title'],
      ),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { dependentNoteId, title, content, status, launchAgent, agentInstruction, agentModel } = call.arguments;

      const result = await this.protocolAdapter.createPrerequisiteNote(
        this.workspaceId,
        dependentNoteId,
        {
          title,
          content,
          taskStatus: status || 'not_started',
          agentConfig: launchAgent ? {  // NEW
            instruction: agentInstruction,
            model: agentModel,
            autoStart: false,  // Don't auto-start from MCP
          } : undefined,
        },
      );

      if (!result.ok) {
        return this.error(result.error);
      }

      const { note, agent } = result.data;

      // Format response
      const parts = [
        `✅ Created prerequisite task: "${note.title}"`,
        ``,
        `**Task Details:**`,
        `- Note ID: ${note.id}`,
        `- Status: ${note.metadata?.task?.status}`,
        `- Blocks: ${dependentNoteId}`,
      ];

      if (agent) {
        parts.push(
          ``,
          `**Agent Assigned:**`,
          `- Agent ID: ${agent.id}`,
          `- Agent Name: ${agent.name}`,
          `- Status: ${agent.status}`,
        );
      }

      return this.success(parts.join('\n'));
    } catch (error) {
      return this.error(`Failed to create prerequisite: ${error}`);
    }
  }
}
```

---

### Step 5: Update Tests (30 min)

#### 5.1 Update Existing Tests

**File**: `src/features/notes/__tests__/create-prerequisite-note.test.ts`

Existing tests should still pass (backward compatible). Add new tests:

```typescript
describe('createPrerequisiteNote with agent', () => {
  it('should create prerequisite and assign agent when agentConfig provided', async () => {
    // Test agent creation flow
  });

  it('should succeed even if agent creation fails', async () => {
    // Test graceful degradation
  });

  it('should work without agentCreator (backward compatible)', async () => {
    // Test with agentCreator = undefined
  });
});
```

#### 5.2 Update MCP Tool Tests

**File**: `src/features/mcp/mcp/__tests__/task-tools.test.ts`

Add tests for new `launchAgent` parameter.

---

## Usage Examples

### From MCP Tool (Agent Chat)

```typescript
// Agent creates prerequisite with another agent
await create_prerequisite({
  dependentNoteId: "my-task-id",
  title: "Setup Database Schema",
  content: "Create tables for user authentication",
  status: "not_started",
  launchAgent: true,  // NEW
  agentInstruction: "Focus on PostgreSQL best practices",
  agentModel: "claude-sonnet-4",
});
```

### From UI (TaskMetadataBar)

```typescript
// User assigns agent to existing task note
const result = await notesClient.createPrerequisiteNote(
  workspace.id,
  currentNoteId,
  {
    title: "Implement API endpoint",
    content: note.content,
    agentConfig: {
      instruction: userInstruction,
      model: selectedModel,
      autoStart: true,
    },
  }
);
```

### From Checklist Item

```typescript
// User delegates checklist item to agent
const result = await notesClient.createPrerequisiteNote(
  workspace.id,
  currentNoteId,
  {
    title: taskText,
    content: "Task delegated from checklist",
    dependencyType: 'related',
    agentConfig: {
      instruction: "Complete this task",
      model: "claude-sonnet-4",
      autoStart: true,
    },
  }
);
```

---

## Testing Plan

### Unit Tests
- [ ] Message builder utility
- [ ] Agent name sanitizer utility
- [ ] createPrerequisiteNote with agentConfig
- [ ] createPrerequisiteNote without agentConfig (backward compat)
- [ ] Graceful degradation when agent creation fails

### Integration Tests
- [ ] MCP tool creates prerequisite with agent
- [ ] UI creates task and assigns agent
- [ ] Checklist item delegation

### Manual Testing
- [ ] Create prerequisite from agent chat with launchAgent=true
- [ ] Verify agent is created and assigned
- [ ] Verify agent receives correct initial message
- [ ] Verify task note shows assigned agent

---

## Success Criteria

- [ ] Utilities created and tested
- [ ] createPrerequisiteNote enhanced with agentConfig
- [ ] All existing tests still pass (backward compatible)
- [ ] New tests for agent creation pass
- [ ] MCP tool updated and tested
- [ ] IPC layer updated
- [ ] Can create prerequisite + agent from MCP tool
- [ ] Can create prerequisite + agent from UI
- [ ] Graceful degradation works (task succeeds even if agent fails)

---

## Next Steps After This

1. **Build UI components** - TaskAgentAssignmentInput, AgentChip, etc.
2. **Integrate into TaskMetadataBar** - Show assigned agents, always-visible input
3. **Update CustomTaskItemView** - Use new method for delegation
4. **Test full workflow** - Agent creates prereq → spawns agent → completes → notifies parent
