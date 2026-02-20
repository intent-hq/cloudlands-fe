# Note Graph Examples & Use Cases

## Example 1: Simple Feature Implementation

### Scenario
User wants to add authentication to their app. Agent discovers it needs database setup first.

### Flow

1. **User creates initial note**
```markdown
# Add User Authentication

Implement login/signup flow with JWT tokens.

## Requirements
- Email/password authentication
- JWT token generation
- Protected routes
```

2. **User marks as task**
```typescript
await taskMetadataService.markAsTask('note-auth', {
  status: 'not_started',
  priority: 'high',
  acceptanceCriteria: [
    'Users can sign up with email/password',
    'Users can log in and receive JWT',
    'Protected routes verify JWT',
  ],
});
```

3. **Agent starts work, discovers prerequisite**
```typescript
// Agent realizes: need database first
await taskMetadataService.proposePrerequisite({
  parentNoteId: 'note-auth',
  title: 'Set up database schema',
  content: `# Database Schema Setup

  Create users table with email, password hash, timestamps.`,
  reason: 'Authentication requires user storage',
});
```

4. **System creates dependency**
```typescript
// Creates new note 'note-db-schema'
// Adds dependency: note-auth depends on note-db-schema
// Updates status: note-auth → 'blocked'
```

5. **Agent works on prerequisite**
```typescript
// Agent assigned to note-db-schema
// Completes the work
await taskMetadataService.updateStatus('note-db-schema', 'complete');
```

6. **System unblocks parent**
```typescript
// Automatically detects note-auth is now unblocked
// Updates status: note-auth → 'ready'
// Emits event: 'task:ready' for note-auth
```

7. **User resumes original task**
```typescript
// User sees note-auth is ready
// Assigns agent to continue
// Agent reads note-db-schema to understand what was built
// Completes authentication implementation
```

### Resulting Graph

```
note-db-schema (complete)
    ↓ blocks
note-auth (ready → in_progress → complete)
```

## Example 2: Complex Feature with Multiple Dependencies

### Scenario
Building a real-time notification system with multiple prerequisites.

### Initial Note

```markdown
# Real-time Notifications

Users should receive instant notifications for important events.
```

### Discovered Dependencies

```
note-notifications (blocked)
    ↓ depends on
    ├─ note-websocket-server (in_progress)
    │   ↓ depends on
    │   └─ note-redis-setup (complete)
    │
    ├─ note-notification-schema (complete)
    │
    └─ note-event-emitter (not_started)
```

### Data Structure

```typescript
// note-notifications
{
  id: 'note-notifications',
  title: 'Real-time Notifications',
  metadata: {
    task: {
      status: 'blocked',
      priority: 'high',
    },
    dependencies: [
      { noteId: 'note-websocket-server', type: 'prerequisite', reason: 'Need WebSocket infrastructure' },
      { noteId: 'note-notification-schema', type: 'prerequisite', reason: 'Need data model' },
      { noteId: 'note-event-emitter', type: 'prerequisite', reason: 'Need event system' },
    ],
    dependents: [],
  },
}

// note-websocket-server
{
  id: 'note-websocket-server',
  title: 'WebSocket Server Setup',
  metadata: {
    task: {
      status: 'in_progress',
      assignedAgentId: 'agent-123',
    },
    dependencies: [
      { noteId: 'note-redis-setup', type: 'prerequisite', reason: 'Need Redis for pub/sub' },
    ],
    dependents: ['note-notifications'],
  },
}
```

### Execution Order (Topological Sort)

```typescript
const order = graphService.getExecutionOrder([
  'note-notifications',
  'note-websocket-server',
  'note-redis-setup',
  'note-notification-schema',
  'note-event-emitter',
]);

// Result: [
//   'note-redis-setup',
//   'note-notification-schema',
//   'note-event-emitter',
//   'note-websocket-server',
//   'note-notifications',
// ]
```

## Example 3: Task Breakdown

### Scenario
Large task gets broken down into subtasks.

### Parent Task

```markdown
# Implement E-commerce Checkout

Complete checkout flow from cart to payment confirmation.
```

### Agent Breaks Down

```typescript
await taskMetadataService.breakDownTask('note-checkout', [
  {
    title: 'Cart Summary Component',
    content: 'Display cart items with quantities and prices',
    acceptanceCriteria: ['Shows all cart items', 'Calculates total', 'Allows quantity changes'],
  },
  {
    title: 'Shipping Address Form',
    content: 'Collect and validate shipping address',
    acceptanceCriteria: ['Form validation', 'Address autocomplete', 'Save to user profile'],
  },
  {
    title: 'Payment Integration',
    content: 'Integrate Stripe payment processing',
    acceptanceCriteria: ['Stripe Elements UI', 'Payment intent creation', 'Error handling'],
  },
  {
    title: 'Order Confirmation',
    content: 'Show order summary and confirmation',
    acceptanceCriteria: ['Order details display', 'Email confirmation', 'Order tracking link'],
  },
]);
```

### Resulting Structure

```
note-checkout (parent, blocked)
    ↓ has children
    ├─ note-cart-summary (complete)
    ├─ note-shipping-form (complete)
    ├─ note-payment-integration (in_progress)
    └─ note-order-confirmation (not_started)
         ↑ depends on
         note-payment-integration
```

### Parent Completion Logic

```typescript
// Parent completes when all children complete
function checkParentCompletion(parentId: NoteId) {
  const children = graphService.getChildren(parentId);
  const allComplete = children.every(
    child => child.metadata?.task?.status === 'complete'
  );

  if (allComplete) {
    taskMetadataService.updateStatus(parentId, 'complete');
  }
}
```

## Example 4: Agent Workflow

### Scenario
Agent working on a task discovers it's blocked.

### Agent's Perspective

```typescript
// Agent is assigned to note-feature-x
const note = await notesService.get('note-feature-x');

// Check if it's a task
if (note.metadata?.task) {
  // Read acceptance criteria
  const criteria = note.metadata.task.acceptanceCriteria;
  console.log('My goals:', criteria);

  // Check dependencies
  const deps = note.metadata.dependencies || [];
  if (deps.length > 0) {
    console.log('I depend on:', deps.map(d => d.noteId));

    // Check if all are complete
    const allComplete = await Promise.all(
      deps.map(async d => {
        const depNote = await notesService.get(d.noteId);
        return depNote?.metadata?.task?.status === 'complete';
      })
    );

    if (!allComplete.every(Boolean)) {
      console.log('I am blocked! Cannot proceed.');
      return;
    }
  }

  // Start work
  await taskMetadataService.updateStatus('note-feature-x', 'in_progress');

  // ... do work ...

  // Discover new prerequisite
  await taskMetadataService.proposePrerequisite({
    parentNoteId: 'note-feature-x',
    title: 'Set up API endpoint',
    content: 'Need REST API for data fetching',
    reason: 'Feature requires backend API',
  });

  // Mark self as blocked
  await taskMetadataService.updateStatus('note-feature-x', 'blocked');
}
```

### MCP Tool Usage

```typescript
// Agent calls MCP tool
{
  "name": "propose_prerequisite_task",
  "arguments": {
    "parentNoteId": "note-feature-x",
    "title": "Set up API endpoint",
    "content": "# API Endpoint Setup\n\nCreate REST endpoint for data fetching.",
    "reason": "Feature requires backend API",
    "acceptanceCriteria": [
      "Endpoint responds to GET requests",
      "Returns JSON data",
      "Includes error handling"
    ]
  }
}
```

## Example 5: UI Interactions

### Notes List with Task Indicators

```svelte
<!-- NotesPanel.svelte -->
<script lang="ts">
  import { notesStateManager } from '$features/notes';
  import TaskStatusBadge from './TaskStatusBadge.svelte';

  $: notes = Array.from(notesStateManager.notes.values());
  $: taskNotes = notes.filter(n => n.metadata?.task);
  $: regularNotes = notes.filter(n => !n.metadata?.task);
</script>

<div class="notes-panel">
  {#if taskNotes.length > 0}
    <section class="task-notes">
      <h3>Tasks</h3>
      {#each taskNotes as note}
        <div class="note-item task-note">
          <TaskStatusBadge status={note.metadata.task.status} />
          <span class="note-title">{note.title}</span>
          {#if note.metadata.dependencies?.length > 0}
            <span class="dependency-count">
              {note.metadata.dependencies.length} deps
            </span>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if regularNotes.length > 0}
    <section class="regular-notes">
      <h3>Notes</h3>
      {#each regularNotes as note}
        <div class="note-item">
          <span class="note-title">{note.title}</span>
        </div>
      {/each}
    </section>
  {/if}
</div>
```

### Task Metadata Editor

```svelte
<!-- TaskMetadataEditor.svelte -->
<script lang="ts">
  import { taskMetadataService } from '$features/tasks';
  import type { Note, TaskStatus } from '$shared/types';

  export let note: Note;

  $: isTask = !!note.metadata?.task;
  $: taskStatus = note.metadata?.task?.status;

  async function toggleTask() {
    if (isTask) {
      // Remove task metadata
      await notesService.update(note.id, {
        metadata: {
          ...note.metadata,
          task: undefined,
          dependencies: undefined,
          dependents: undefined,
        },
      });
    } else {
      // Add task metadata
      await taskMetadataService.markAsTask(note.id, {
        status: 'not_started',
        priority: 'medium',
      });
    }
  }

  async function updateStatus(newStatus: TaskStatus) {
    await taskMetadataService.updateStatus(note.id, newStatus);
  }
</script>

<div class="task-metadata-editor">
  <button onclick={toggleTask}>
    {isTask ? 'Remove Task Metadata' : 'Make This a Task'}
  </button>

  {#if isTask}
    <div class="task-controls">
      <label>
        Status:
        <select value={taskStatus} onchange={(e) => updateStatus(e.target.value)}>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="complete">Complete</option>
        </select>
      </label>

      <label>
        Priority:
        <select value={note.metadata.task.priority}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </label>
    </div>
  {/if}
</div>
```

### Dependency Picker

```svelte
<!-- DependencyPicker.svelte -->
<script lang="ts">
  import { taskMetadataService, graphService } from '$features/tasks';
  import { notesStateManager } from '$features/notes';
  import type { Note } from '$shared/types';

  export let note: Note;

  $: allNotes = Array.from(notesStateManager.notes.values());
  $: availableNotes = allNotes.filter(n =>
    n.id !== note.id && // Not self
    !graphService.detectCycle(note.id, n.id) // Won't create cycle
  );

  let selectedNoteId = '';
  let reason = '';

  async function addDependency() {
    if (!selectedNoteId) return;

    await taskMetadataService.addDependency(
      note.id,
      selectedNoteId,
      reason || undefined
    );

    // Reset form
    selectedNoteId = '';
    reason = '';
  }
</script>

<div class="dependency-picker">
  <h4>Add Dependency</h4>

  <label>
    This task depends on:
    <select bind:value={selectedNoteId}>
      <option value="">Select a note...</option>
      {#each availableNotes as availableNote}
        <option value={availableNote.id}>
          {availableNote.title}
        </option>
      {/each}
    </select>
  </label>

  <label>
    Reason (optional):
    <input type="text" bind:value={reason} placeholder="Why is this needed?" />
  </label>

  <button onclick={addDependency} disabled={!selectedNoteId}>
    Add Dependency
  </button>

  {#if note.metadata?.dependencies?.length > 0}
    <div class="current-dependencies">
      <h5>Current Dependencies</h5>
      {#each note.metadata.dependencies as dep}
        {@const depNote = notesStateManager.findById(dep.noteId)}
        <div class="dependency-item">
          <span class="dep-title">{depNote?.title || 'Unknown'}</span>
          {#if dep.reason}
            <span class="dep-reason">{dep.reason}</span>
          {/if}
          <button onclick={() => taskMetadataService.removeDependency(note.id, dep.noteId)}>
            Remove
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

## Example 6: Query Patterns

### Get All Ready Tasks

```typescript
// Tasks that are ready to work on
const readyTasks = graphService.getReadyTasks();

// Or using notes store
const readyTasks = Array.from(notesStateManager.notes.values())
  .filter(note => {
    if (!note.metadata?.task) return false;
    if (note.metadata.task.status !== 'not_started' &&
        note.metadata.task.status !== 'blocked') return false;

    // Check if all dependencies are complete
    const deps = note.metadata.dependencies || [];
    return deps.every(dep => {
      const depNote = notesStateManager.findById(dep.noteId);
      return depNote?.metadata?.task?.status === 'complete';
    });
  });
```

### Get Blocked Tasks

```typescript
const blockedTasks = Array.from(notesStateManager.notes.values())
  .filter(note => note.metadata?.task?.status === 'blocked');
```

### Get Task by Priority

```typescript
const highPriorityTasks = Array.from(notesStateManager.notes.values())
  .filter(note =>
    note.metadata?.task?.priority === 'high' ||
    note.metadata?.task?.priority === 'critical'
  )
  .sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const aPriority = a.metadata?.task?.priority || 'medium';
    const bPriority = b.metadata?.task?.priority || 'medium';
    return priorityOrder[aPriority] - priorityOrder[bPriority];
  });
```

### Get Dependency Chain

```typescript
function getDependencyChain(noteId: NoteId): Note[] {
  const chain: Note[] = [];
  const visited = new Set<NoteId>();

  function traverse(id: NoteId) {
    if (visited.has(id)) return;
    visited.add(id);

    const note = notesStateManager.findById(id);
    if (!note) return;

    chain.push(note);

    const deps = note.metadata?.dependencies || [];
    for (const dep of deps) {
      traverse(dep.noteId);
    }
  }

  traverse(noteId);
  return chain;
}
```

## Example 7: Agent Rules Integration

### Task-Aware Agent Prompt

```markdown
# Task-Aware Agent Rules

You are working on a task-note. Here's what you need to know:

## Current Task
- **Title**: {{note.title}}
- **Status**: {{note.metadata.task.status}}
- **Priority**: {{note.metadata.task.priority}}

## Acceptance Criteria
{{#each note.metadata.task.acceptanceCriteria}}
- [ ] {{this}}
{{/each}}

## Dependencies
{{#if note.metadata.dependencies}}
This task depends on:
{{#each note.metadata.dependencies}}
- **{{this.noteId}}**: {{this.reason}}
  Status: {{lookup ../dependencyStatuses this.noteId}}
{{/each}}
{{else}}
No dependencies - you can start immediately!
{{/if}}

## Your Mission
1. Review the acceptance criteria
2. Check that all dependencies are complete
3. If blocked, propose new prerequisites using `propose_prerequisite_task`
4. Update your status as you work using `update_task_status`
5. Mark complete when all criteria are met
```

## Summary

These examples demonstrate:

1. **Simple workflows** - Single task with one prerequisite
2. **Complex graphs** - Multiple dependencies and levels
3. **Task breakdown** - Parent-child relationships
4. **Agent integration** - How agents interact with tasks
5. **UI patterns** - How to render and interact with task-notes
6. **Query patterns** - Common ways to find and filter tasks
7. **Agent rules** - How to make agents task-aware

The key insight is that **tasks are just notes with extra metadata**, which keeps the system simple while enabling powerful task management capabilities.
