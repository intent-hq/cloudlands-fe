# Phase 1B: TDD Implementation Plan - Dependencies & Graph

## Status: 🚧 NOT STARTED

## Goal
Implement dependency tracking and graph operations. By the end of Phase 1B, notes can have dependencies on other notes, the system detects cycles, and we can query the dependency graph.

## Prerequisites
- ✅ Phase 1A complete (basic task metadata)

## Key Design Decisions
1. **Dependencies stored, dependents computed** - Only store `dependencies[]` in metadata, compute dependents on-demand
2. **Cycle detection required** - Prevent circular dependencies when adding links
3. **No automatic status updates yet** - Keep Phase 1B focused on graph structure only
4. **Support both task and non-task notes** - Dependencies work for any note, not just tasks

## TDD Increments

### Increment 1: Dependency Schema & Types (30 min)
**Goal**: Define TypeScript types and Zod schemas for note dependencies.

**Test**: Type checking passes
```typescript
// src/features/notes/__tests__/dependency-types.test.ts
describe('NoteDependency types', () => {
  it('should accept valid dependency metadata', () => {
    const dependency: NoteDependency = {
      noteId: 'note-123' as NoteId,
      type: 'blocks',
      reason: 'Must complete authentication first',
      createdAt: new Date().toISOString(),
    };
    expect(dependency).toBeDefined();
  });

  it('should accept all dependency types', () => {
    const types: NoteDependency['type'][] = ['blocks', 'related', 'prerequisite'];
    expect(types).toHaveLength(3);
  });
});
```

**Implementation**:
- Add `NoteDependency` interface to `src/shared/types.ts`
- Add `DependencyType` type
- Update `NoteMetadata` interface to include optional `dependencies` field
- Add Zod schemas in `src/shared/schemas.ts`

**Validation**:
- Types compile without errors
- Zod schemas validate correctly

---

### Increment 2: addDependency - Happy Path (45 min)
**Goal**: Implement `addDependency()` method that links one note to another.

**Test**:
```typescript
describe('NotesService.addDependency - Happy Path', () => {
  it('should add dependency to a note', async () => {
    // Arrange
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });

    // Act
    const result = await service.addDependency(
      workspaceId,
      note1.id,
      {
        noteId: note2.id,
        type: 'blocks',
        reason: 'Must complete Task 2 first'
      }
    );

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toHaveLength(1);
      expect(result.data.metadata?.dependencies?.[0].noteId).toBe(note2.id);
      expect(result.data.metadata?.dependencies?.[0].type).toBe('blocks');
    }
  });

  it('should allow multiple dependencies on same note', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });
    const note3 = await service.createNote({ workspaceId, title: 'Task 3' });

    await service.addDependency(workspaceId, note1.id, { noteId: note2.id, type: 'blocks' });
    const result = await service.addDependency(workspaceId, note1.id, { noteId: note3.id, type: 'blocks' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toHaveLength(2);
    }
  });

  it('should emit note:updated event when adding dependency', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });

    const eventSpy = vi.fn();
    eventBus.on('note:updated', eventSpy);

    await service.addDependency(workspaceId, note1.id, { noteId: note2.id, type: 'blocks' });

    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: note1.id,
        workspaceId: workspaceId,
      })
    );
  });
});
```

**Implementation**:
- Add `addDependency()` method to `NotesService`
- Method updates note metadata with dependency data
- Returns updated note
- Emits `note:updated` event

**Validation**: Tests pass

---

### Increment 3: addDependency - Edge Cases (45 min)
**Goal**: Handle error cases and validation for `addDependency()`.

**Tests**:
```typescript
describe('NotesService.addDependency - Edge Cases', () => {
  it('should return error when source note does not exist', async () => {
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });
    const result = await service.addDependency(
      workspaceId,
      'nonexistent' as NoteId,
      { noteId: note2.id, type: 'blocks' }
    );

    expect(result.ok).toBe(false);
  });

  it('should return error when target note does not exist', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const result = await service.addDependency(
      workspaceId,
      note1.id,
      { noteId: 'nonexistent' as NoteId, type: 'blocks' }
    );

    expect(result.ok).toBe(false);
  });

  it('should prevent self-dependency', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const result = await service.addDependency(
      workspaceId,
      note1.id,
      { noteId: note1.id, type: 'blocks' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('self');
    }
  });

  it('should prevent duplicate dependencies', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });

    await service.addDependency(workspaceId, note1.id, { noteId: note2.id, type: 'blocks' });
    const result = await service.addDependency(workspaceId, note1.id, { noteId: note2.id, type: 'blocks' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('already exists');
    }
  });
});
```

**Implementation**:
- Add validation for source and target note existence
- Add validation to prevent self-dependencies
- Add validation to prevent duplicate dependencies
- Return appropriate error messages

**Validation**: Tests pass

---

### Increment 4: Cycle Detection (60 min)
**Goal**: Detect and prevent circular dependencies.

**Tests**:
```typescript
describe('NotesService.addDependency - Cycle Detection', () => {
  it('should detect direct cycle (A → B → A)', async () => {
    const noteA = await service.createNote({ workspaceId, title: 'Task A' });
    const noteB = await service.createNote({ workspaceId, title: 'Task B' });

    // A depends on B
    await service.addDependency(workspaceId, noteA.id, { noteId: noteB.id, type: 'blocks' });

    // Try to make B depend on A (would create cycle)
    const result = await service.addDependency(workspaceId, noteB.id, { noteId: noteA.id, type: 'blocks' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('cycle');
    }
  });

  it('should detect indirect cycle (A → B → C → A)', async () => {
    const noteA = await service.createNote({ workspaceId, title: 'Task A' });
    const noteB = await service.createNote({ workspaceId, title: 'Task B' });
    const noteC = await service.createNote({ workspaceId, title: 'Task C' });

    // A → B → C
    await service.addDependency(workspaceId, noteA.id, { noteId: noteB.id, type: 'blocks' });
    await service.addDependency(workspaceId, noteB.id, { noteId: noteC.id, type: 'blocks' });

    // Try to make C → A (would create cycle)
    const result = await service.addDependency(workspaceId, noteC.id, { noteId: noteA.id, type: 'blocks' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('cycle');
    }
  });

  it('should allow diamond dependencies (A → B, A → C, B → D, C → D)', async () => {
    const noteA = await service.createNote({ workspaceId, title: 'Task A' });
    const noteB = await service.createNote({ workspaceId, title: 'Task B' });
    const noteC = await service.createNote({ workspaceId, title: 'Task C' });
    const noteD = await service.createNote({ workspaceId, title: 'Task D' });

    // Create diamond: A depends on B and C, both B and C depend on D
    await service.addDependency(workspaceId, noteA.id, { noteId: noteB.id, type: 'blocks' });
    await service.addDependency(workspaceId, noteA.id, { noteId: noteC.id, type: 'blocks' });
    await service.addDependency(workspaceId, noteB.id, { noteId: noteD.id, type: 'blocks' });
    const result = await service.addDependency(workspaceId, noteC.id, { noteId: noteD.id, type: 'blocks' });

    expect(result.ok).toBe(true); // Diamond is valid, not a cycle
  });
});
```

**Implementation**:
- Add `detectCycle()` private method using DFS traversal
- Check for cycles before adding dependency
- Return error if cycle would be created

**Validation**: Tests pass

---

### Increment 5: removeDependency (30 min)
**Goal**: Implement method to remove dependencies.

**Tests**:
```typescript
describe('NotesService.removeDependency', () => {
  it('should remove dependency from note', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });

    await service.addDependency(workspaceId, note1.id, { noteId: note2.id, type: 'blocks' });
    const result = await service.removeDependency(workspaceId, note1.id, note2.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata?.dependencies).toHaveLength(0);
    }
  });

  it('should emit note:updated event when removing dependency', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });

    await service.addDependency(workspaceId, note1.id, { noteId: note2.id, type: 'blocks' });

    const eventSpy = vi.fn();
    eventBus.on('note:updated', eventSpy);

    await service.removeDependency(workspaceId, note1.id, note2.id);

    expect(eventSpy).toHaveBeenCalled();
  });

  it('should return error when dependency does not exist', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });

    const result = await service.removeDependency(workspaceId, note1.id, note2.id);

    expect(result.ok).toBe(false);
  });
});
```

**Implementation**:
- Add `removeDependency()` method
- Remove dependency from array
- Emit `note:updated` event
- Return error if dependency doesn't exist

**Validation**: Tests pass

---

### Increment 6: getDependencies (30 min)
**Goal**: Query what a note depends on.

**Tests**:
```typescript
describe('NotesService.getDependencies', () => {
  it('should return all dependencies for a note', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });
    const note3 = await service.createNote({ workspaceId, title: 'Task 3' });

    await service.addDependency(workspaceId, note1.id, { noteId: note2.id, type: 'blocks' });
    await service.addDependency(workspaceId, note1.id, { noteId: note3.id, type: 'prerequisite' });

    const result = await service.getDependencies(workspaceId, note1.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data.map(d => d.noteId)).toContain(note2.id);
      expect(result.data.map(d => d.noteId)).toContain(note3.id);
    }
  });

  it('should return empty array for note with no dependencies', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const result = await service.getDependencies(workspaceId, note1.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });
});
```

**Implementation**:
- Add `getDependencies()` method
- Return `note.metadata.dependencies` or empty array

**Validation**: Tests pass

---

### Increment 7: getDependents (45 min)
**Goal**: Query what depends on a note (computed on-demand).

**Tests**:
```typescript
describe('NotesService.getDependents', () => {
  it('should compute dependents by scanning all notes', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const note2 = await service.createNote({ workspaceId, title: 'Task 2' });
    const note3 = await service.createNote({ workspaceId, title: 'Task 3' });

    // note2 and note3 both depend on note1
    await service.addDependency(workspaceId, note2.id, { noteId: note1.id, type: 'blocks' });
    await service.addDependency(workspaceId, note3.id, { noteId: note1.id, type: 'prerequisite' });

    const result = await service.getDependents(workspaceId, note1.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data.map(d => d.noteId)).toContain(note2.id);
      expect(result.data.map(d => d.noteId)).toContain(note3.id);
    }
  });

  it('should return empty array for note with no dependents', async () => {
    const note1 = await service.createNote({ workspaceId, title: 'Task 1' });
    const result = await service.getDependents(workspaceId, note1.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });
});
```

**Implementation**:
- Add `getDependents()` method
- Scan all notes in workspace
- Find notes that have this noteId in their dependencies
- Return array of dependents with metadata

**Validation**: Tests pass

---

### Increment 8: Integration Test (30 min)
**Goal**: Test complete dependency graph workflow.

**Test**:
```typescript
describe('NotesService - Dependency Graph Integration', () => {
  it('should handle complex dependency graph', async () => {
    // Create a realistic task breakdown:
    // Feature (A) depends on:
    //   - Backend API (B) depends on Database Schema (D)
    //   - Frontend UI (C) depends on Backend API (B)

    const featureNote = await service.createNote({ workspaceId, title: 'Feature: User Auth' });
    const backendNote = await service.createNote({ workspaceId, title: 'Backend API' });
    const frontendNote = await service.createNote({ workspaceId, title: 'Frontend UI' });
    const dbNote = await service.createNote({ workspaceId, title: 'Database Schema' });

    // Mark all as tasks
    await service.markAsTask(workspaceId, featureNote.id, { status: 'not_started' });
    await service.markAsTask(workspaceId, backendNote.id, { status: 'not_started' });
    await service.markAsTask(workspaceId, frontendNote.id, { status: 'not_started' });
    await service.markAsTask(workspaceId, dbNote.id, { status: 'not_started' });

    // Build dependency graph
    await service.addDependency(workspaceId, featureNote.id, { noteId: backendNote.id, type: 'blocks' });
    await service.addDependency(workspaceId, featureNote.id, { noteId: frontendNote.id, type: 'blocks' });
    await service.addDependency(workspaceId, backendNote.id, { noteId: dbNote.id, type: 'prerequisite' });
    await service.addDependency(workspaceId, frontendNote.id, { noteId: backendNote.id, type: 'blocks' });

    // Verify dependencies
    const featureDeps = await service.getDependencies(workspaceId, featureNote.id);
    expect(featureDeps.ok && featureDeps.data).toHaveLength(2);

    // Verify dependents
    const backendDependents = await service.getDependents(workspaceId, backendNote.id);
    expect(backendDependents.ok && backendDependents.data).toHaveLength(2); // Feature and Frontend

    const dbDependents = await service.getDependents(workspaceId, dbNote.id);
    expect(dbDependents.ok && dbDependents.data).toHaveLength(1); // Backend

    // Verify cycle prevention
    const cycleResult = await service.addDependency(workspaceId, dbNote.id, { noteId: featureNote.id, type: 'blocks' });
    expect(cycleResult.ok).toBe(false);
  });
});
```

**Implementation**: All previous increments working together

**Validation**: Integration test passes

---

## Phase 1B Complete! 🎉

**Deliverables:**
- ✅ Dependency tracking (add, remove, query)
- ✅ Cycle detection
- ✅ Graph queries (dependencies and dependents)
- ✅ ~40 tests passing

**Next Steps:**
- **Phase 1C**: Agent assignment tracking and integration tests
- **Phase 2**: Minimal UI for visualizing dependencies
- **Phase 3**: Agent integration with MCP tools

---

## Estimated Timeline

| Increment | Time | Cumulative |
|-----------|------|------------|
| 1. Schema & Types | 30 min | 30 min |
| 2. addDependency - Happy Path | 45 min | 1h 15m |
| 3. addDependency - Edge Cases | 45 min | 2h |
| 4. Cycle Detection | 60 min | 3h |
| 5. removeDependency | 30 min | 3h 30m |
| 6. getDependencies | 30 min | 4h |
| 7. getDependents | 45 min | 4h 45m |
| 8. Integration Test | 30 min | 5h 15m |

**Total: ~5-6 hours** (one focused work session or two shorter sessions)
