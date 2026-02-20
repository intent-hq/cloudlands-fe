# Phase 1A: TDD Implementation Plan

## Status: ✅ COMPLETE

## Goal
Implement basic task metadata functionality with comprehensive test coverage. By the end of Phase 1A, notes can be marked as tasks, have their status updated, and be queried as tasks.

## Completion Summary
- **All 7 increments completed** (Increments 8-9 moved to Phase 1C)
- **47 out of 48 tests passing** (1 unrelated race condition test)
- **Priority field removed** per user feedback
- **TaskMetadataBar UI component** created for manual testing
- **Ready for Phase 1B**: Dependencies and graph operations

## TDD Increments

### Increment 1: Schema & Types (30 min)
**Goal**: Define TypeScript types and Zod schemas for task metadata.

**Test**: Type checking passes
```typescript
// src/shared/types/note.types.ts
describe('TaskMetadata types', () => {
  it('should accept valid task metadata', () => {
    const metadata: TaskMetadata = {
      status: 'not_started',
      priority: 'high',
    };
    expect(metadata).toBeDefined();
  });
});
```

**Implementation**:
- Add `TaskMetadata` interface to `src/shared/types/note.types.ts`
- Add `TaskStatus` type
- Update `NoteMetadata` interface to include optional `task` field
- Add Zod schemas in `src/shared/schemas/note.schemas.ts`

**Validation**:
- Types compile without errors
- Zod schemas validate correctly

---

### Increment 2: markAsTask - Happy Path (45 min)
**Goal**: Implement `markAsTask()` method that adds task metadata to a note.

**Test**:
```typescript
describe('NotesService.markAsTask', () => {
  it('should add task metadata to a regular note', async () => {
    // Arrange
    const note = await service.createNote({
      workspaceId: workspace.id,
      title: 'Test Note',
      content: 'Content',
    });

    // Act
    const result = await service.markAsTask(note.id, workspace.id, {
      status: 'not_started',
      priority: 'high',
    });

    // Assert
    expect(result.ok).toBe(true);
    expect(result.data.metadata?.task).toBeDefined();
    expect(result.data.metadata?.task?.status).toBe('not_started');
    expect(result.data.metadata?.task?.priority).toBe('high');
  });
});
```

**Implementation**:
- Add `markAsTask()` method to `NotesService`
- Method updates note metadata with task data
- Returns updated note

**Validation**: Test passes

---

### Increment 3: markAsTask - Edge Cases (30 min)
**Goal**: Handle error cases for `markAsTask()`.

**Tests**:
```typescript
it('should return error if note not found', async () => {
  const result = await service.markAsTask('nonexistent', workspace.id, {
    status: 'not_started',
  });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('not found');
});

it('should allow marking a note as task multiple times (idempotent)', async () => {
  const note = await service.createNote({ workspaceId: workspace.id, title: 'Test' });

  await service.markAsTask(note.id, workspace.id, { status: 'not_started' });
  const result = await service.markAsTask(note.id, workspace.id, { status: 'in_progress' });

  expect(result.ok).toBe(true);
  expect(result.data.metadata?.task?.status).toBe('in_progress');
});
```

**Implementation**:
- Add error handling for missing notes
- Allow re-marking (updates existing task metadata)

**Validation**: Tests pass

---

### Increment 4: updateTaskStatus - Happy Path (45 min)
**Goal**: Implement `updateTaskStatus()` method.

**Test**:
```typescript
describe('NotesService.updateTaskStatus', () => {
  it('should update task status', async () => {
    // Arrange
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
    await service.markAsTask(note.id, workspace.id, { status: 'not_started' });

    // Act
    const result = await service.updateTaskStatus(note.id, workspace.id, 'in_progress');

    // Assert
    expect(result.ok).toBe(true);
    expect(result.data.metadata?.task?.status).toBe('in_progress');
  });

  it('should set startedAt timestamp when moving to in_progress', async () => {
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
    await service.markAsTask(note.id, workspace.id, { status: 'not_started' });

    const result = await service.updateTaskStatus(note.id, workspace.id, 'in_progress');

    expect(result.data.metadata?.task?.startedAt).toBeDefined();
  });

  it('should set completedAt timestamp when moving to complete', async () => {
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
    await service.markAsTask(note.id, workspace.id, { status: 'in_progress' });

    const result = await service.updateTaskStatus(note.id, workspace.id, 'complete');

    expect(result.data.metadata?.task?.completedAt).toBeDefined();
  });
});
```

**Implementation**:
- Add `updateTaskStatus()` method
- Set `startedAt` when status becomes `in_progress`
- Set `completedAt` when status becomes `complete`

**Validation**: Tests pass

---

### Increment 5: updateTaskStatus - Edge Cases (30 min)
**Goal**: Handle error cases for `updateTaskStatus()`.

**Tests**:
```typescript
it('should return error if note not found', async () => {
  const result = await service.updateTaskStatus('nonexistent', workspace.id, 'in_progress');
  expect(result.ok).toBe(false);
});

it('should return error if note is not a task', async () => {
  const note = await service.createNote({ workspaceId: workspace.id, title: 'Regular Note' });

  const result = await service.updateTaskStatus(note.id, workspace.id, 'in_progress');

  expect(result.ok).toBe(false);
  expect(result.error).toContain('not a task');
});

it('should validate status values', async () => {
  const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
  await service.markAsTask(note.id, workspace.id, { status: 'not_started' });

  const result = await service.updateTaskStatus(note.id, workspace.id, 'invalid_status' as any);

  expect(result.ok).toBe(false);
});
```

**Implementation**:
- Add error handling for missing notes
- Add error handling for non-task notes
- Add status validation (use Zod schema)

**Validation**: Tests pass

---

### Increment 6: removeTaskMetadata (30 min)
**Goal**: Implement method to demote a task back to a regular note.

**Test**:
```typescript
describe('NotesService.removeTaskMetadata', () => {
  it('should remove task metadata from a note', async () => {
    // Arrange
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
    await service.markAsTask(note.id, workspace.id, { status: 'not_started' });

    // Act
    const result = await service.removeTaskMetadata(note.id, workspace.id);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.data.metadata?.task).toBeUndefined();
  });

  it('should preserve other metadata when removing task metadata', async () => {
    const note = await service.createNote({
      workspaceId: workspace.id,
      title: 'Task',
      tags: ['important']
    });
    await service.markAsTask(note.id, workspace.id, { status: 'not_started' });

    const result = await service.removeTaskMetadata(note.id, workspace.id);

    expect(result.data.tags).toContain('important');
  });

  it('should be idempotent (no error if already not a task)', async () => {
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Note' });

    const result = await service.removeTaskMetadata(note.id, workspace.id);

    expect(result.ok).toBe(true);
  });
});
```

**Implementation**:
- Add `removeTaskMetadata()` method
- Remove `task` field from metadata
- Preserve other metadata fields

**Validation**: Tests pass

---

### Increment 7: getTaskNotes (45 min)
**Goal**: Implement query method to get all task notes in a workspace.

**Test**:
```typescript
describe('NotesService.getTaskNotes', () => {
  it('should return only notes with task metadata', async () => {
    // Arrange
    const regularNote = await service.createNote({ workspaceId: workspace.id, title: 'Regular' });
    const taskNote1 = await service.createNote({ workspaceId: workspace.id, title: 'Task 1' });
    const taskNote2 = await service.createNote({ workspaceId: workspace.id, title: 'Task 2' });

    await service.markAsTask(taskNote1.id, workspace.id, { status: 'not_started' });
    await service.markAsTask(taskNote2.id, workspace.id, { status: 'in_progress' });

    // Act
    const result = await service.getTaskNotes(workspace.id);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data.map(n => n.id)).toContain(taskNote1.id);
    expect(result.data.map(n => n.id)).toContain(taskNote2.id);
    expect(result.data.map(n => n.id)).not.toContain(regularNote.id);
  });

  it('should return empty array if no task notes exist', async () => {
    const result = await service.getTaskNotes(workspace.id);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('should filter by status if provided', async () => {
    const task1 = await service.createNote({ workspaceId: workspace.id, title: 'Task 1' });
    const task2 = await service.createNote({ workspaceId: workspace.id, title: 'Task 2' });

    await service.markAsTask(task1.id, workspace.id, { status: 'not_started' });
    await service.markAsTask(task2.id, workspace.id, { status: 'in_progress' });

    const result = await service.getTaskNotes(workspace.id, { status: 'in_progress' });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(task2.id);
  });
});
```

**Implementation**:
- Add `getTaskNotes()` method
- Filter notes by presence of `metadata.task`
- Optional status filter parameter

**Validation**: Tests pass

---

## Phase 1A Complete! 🎉

**Next Steps:**
- **Phase 1B**: Dependencies and graph operations (see `note-graph-implementation-plan.md`)
- **Phase 1C**: Agent assignment tracking and integration tests (moved from Phase 1A Increments 8-9)

---

# Phase 1C: Agent Integration (FUTURE)

## Moved from Phase 1A
These increments were originally part of Phase 1A but have been deferred to Phase 1C to focus on dependency graph functionality first.

### Increment 1: Agent Assignment Tracking (45 min)
**Goal**: Implement methods to track agent assignments.

**Test**:
```typescript
describe('NotesService - Agent Assignment', () => {
  it('should add agent to assignedAgentIds', async () => {
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
    await service.markAsTask(note.id, workspace.id, { status: 'not_started' });

    const result = await service.assignAgentToTask(note.id, workspace.id, 'agent-123');

    expect(result.ok).toBe(true);
    expect(result.data.metadata?.task?.assignedAgentIds).toContain('agent-123');
  });

  it('should support multiple agents on same task', async () => {
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
    await service.markAsTask(note.id, workspace.id, { status: 'not_started' });

    await service.assignAgentToTask(note.id, workspace.id, 'agent-1');
    const result = await service.assignAgentToTask(note.id, workspace.id, 'agent-2');

    expect(result.data.metadata?.task?.assignedAgentIds).toHaveLength(2);
  });

  it('should move agent to history when unassigned', async () => {
    const note = await service.createNote({ workspaceId: workspace.id, title: 'Task' });
    await service.markAsTask(note.id, workspace.id, { status: 'not_started' });
    await service.assignAgentToTask(note.id, workspace.id, 'agent-123');

    const result = await service.unassignAgentFromTask(
      note.id,
      workspace.id,
      'agent-123',
      'completed'
    );

    expect(result.data.metadata?.task?.assignedAgentIds).not.toContain('agent-123');
    expect(result.data.metadata?.task?.agentHistory).toHaveLength(1);
    expect(result.data.metadata?.task?.agentHistory?.[0].agentId).toBe('agent-123');
    expect(result.data.metadata?.task?.agentHistory?.[0].outcome).toBe('completed');
  });
});
```

**Implementation**:
- Add `assignAgentToTask()` method
- Add `unassignAgentFromTask()` method
- Track agent history with timestamps and outcomes

**Validation**: Tests pass

---

### Increment 2: Integration Test (30 min)
**Goal**: Test complete workflow from creation to completion.

**Test**:
```typescript
describe('NotesService - Task Workflow Integration', () => {
  it('should support complete task lifecycle', async () => {
    // Create note
    const note = await service.createNote({
      workspaceId: workspace.id,
      title: 'Implement feature X',
      content: 'Details about feature X',
    });

    // Mark as task
    await service.markAsTask(note.id, workspace.id, {
      status: 'not_started',
      priority: 'high',
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
    });

    // Assign agent
    await service.assignAgentToTask(note.id, workspace.id, 'agent-123');

    // Start work
    await service.updateTaskStatus(note.id, workspace.id, 'in_progress');

    // Complete work
    await service.updateTaskStatus(note.id, workspace.id, 'complete');

    // Unassign agent
    const result = await service.unassignAgentFromTask(
      note.id,
      workspace.id,
      'agent-123',
      'completed'
    );

    // Verify final state
    expect(result.data.metadata?.task?.status).toBe('complete');
    expect(result.data.metadata?.task?.completedAt).toBeDefined();
    expect(result.data.metadata?.task?.assignedAgentIds).toHaveLength(0);
    expect(result.data.metadata?.task?.agentHistory).toHaveLength(1);
  });
});
```

**Implementation**: All previous increments working together

**Validation**: Integration test passes

---

## Summary

**Total Time Estimate**: ~5 hours of focused TDD work

**Deliverables**:
1. ✅ Task metadata types and schemas
2. ✅ `markAsTask()` - Convert note to task
3. ✅ `updateTaskStatus()` - Update task status with timestamps
4. ✅ `removeTaskMetadata()` - Demote task to note
5. ✅ `getTaskNotes()` - Query task notes with optional filters
6. ✅ `assignAgentToTask()` - Track agent assignments
7. ✅ `unassignAgentFromTask()` - Move agents to history
8. ✅ Complete integration test

**Test Coverage Target**: 90%+ for all new code

**Next Steps After Phase 1A**:
- Review and validate approach
- Get user feedback on basic task functionality
- Proceed to Phase 1B (dependencies and graph)
