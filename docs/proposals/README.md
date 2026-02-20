# Note Graph Proposal - Documentation Index

## Overview

This directory contains the complete proposal for implementing a **note-based task dependency graph** in the Intent app. The proposal addresses the "rabbit hole problem" in agent-assisted development by adding task management capabilities to notes.

## Key Documents

### 1. [Implementation Plan](./note-graph-implementation-plan.md)
**Start here** for the high-level roadmap.

- **What**: Phased implementation plan (5 phases over 10 weeks)
- **Why**: Breaks down the work into manageable chunks
- **Who**: For project managers and developers planning the work

**Key Sections:**
- Core data model (extended Note type)
- Phase 1: Foundation (schema + NotesService methods) - 2 weeks
- Phase 2: Minimal UI (basic task indicators) - 1 week
- Phase 3: Agent Integration (MCP tools, task-aware rules) - 2 weeks
- Future Enhancements (build only if needed based on usage)

### 2. [Architecture](./note-graph-architecture.md)
**Deep dive** into the technical design.

- **What**: Detailed architecture and implementation patterns
- **Why**: Explains how to solve the "not all notes are tasks" challenge
- **Who**: For developers implementing the features

**Key Sections:**
- Type discrimination and progressive disclosure
- Dependency graph representation (stored in note metadata)
- Graph algorithms (cycle detection, topological sort)
- Simplified service layer (all operations in NotesService)
- Event-driven updates and reactivity
- Integration points (MCP tools, UI components, agent rules)

### 3. [Examples & Use Cases](./note-graph-examples.md)
**Concrete examples** of how the system works.

- **What**: Real-world scenarios and code examples
- **Why**: Makes the abstract concepts concrete
- **Who**: For everyone - helps visualize the end result

**Key Examples:**
- Simple feature implementation (auth with DB prerequisite)
- Complex feature with multiple dependencies (notifications)
- Task breakdown (e-commerce checkout)
- Agent workflow (discovering blockers)
- UI interactions (task editor, dependency picker)
- Query patterns (ready tasks, blocked tasks, dependency chains)
- Agent rules integration (task-aware prompts)

### 4. [Legacy Tasks Proposal](./legacy-tasks-proposal.md)
**Original proposal** that was abandoned.

- **What**: The first-class Task entity approach
- **Why**: Provides context for why we pivoted
- **Who**: For historical reference

**Key Differences:**
- Tasks as separate entities vs. task metadata in notes
- Loose coupling vs. tight integration
- More complex data model vs. simpler note-centric approach

## Quick Start

### For Project Managers
1. Read the [Implementation Plan](./note-graph-implementation-plan.md) executive summary
2. Review the phase breakdown and timeline
3. Identify which phases align with your priorities
4. Decide on MVP scope (likely Phase 1-2)

### For Developers
1. Read the [Implementation Plan](./note-graph-implementation-plan.md) - focus on Phases 1-3
2. Deep dive into [Architecture](./note-graph-architecture.md) - note the simplified service layer
3. Reference [Examples](./note-graph-examples.md) while implementing
4. Check the abandoned branch for reusable UI components
5. Start with Phase 1, add minimal UI in Phase 2, rush to Phase 3

### For Designers
1. Review [Examples](./note-graph-examples.md) for UI patterns
2. Check the abandoned branch (`tchu-task-note-rendering`) for existing UI components
3. Focus on minimal UI in Phase 2 - just task status badges and basic indicators
4. Consider how to make task features discoverable without cluttering regular notes

### For Product Owners
1. Read all three main documents to understand the full vision
2. Identify must-have vs. nice-to-have features
3. Consider user workflows and pain points
4. Provide feedback on the phasing and priorities

## Core Concepts

### Notes as Flexible Containers
- **Not all notes are tasks**, but any note can become a task
- Task metadata is optional and lives in `note.metadata.task`
- Notes can transition between being tasks and regular notes
- UI adapts based on whether task metadata exists

### Dependency Graph
- Notes can depend on other notes (prerequisites)
- Dependencies form a Directed Acyclic Graph (DAG)
- System prevents circular dependencies
- Automatic status updates when dependencies complete

### Task Status Lifecycle
```
proposed → not_started → in_progress → complete
              ↓              ↓
           blocked ←────────┘
              ↓
           ready (when dependencies complete)
```

### Agent Integration
- Agents can be assigned to task-notes
- Agents can query dependencies and status
- Agents can propose new prerequisites
- Agents can update task status via MCP tools

## Design Principles

1. **Simplicity**: One entity (Note) instead of two (Task + Note)
2. **Flexibility**: Notes can be tasks or not, with smooth transitions
3. **Leverage Existing**: Build on note infrastructure (versioning, comments, references)
4. **Progressive Disclosure**: Task features appear only when relevant
5. **Event-Driven**: Reactive updates keep UI and agents in sync

## Success Criteria

The implementation succeeds if:

1. **Visibility**: Users can always see what's blocking what
2. **Clarity**: Always clear what to work on next
3. **Context Preservation**: No context lost across task boundaries
4. **Escape Hatch**: Agents can request help when stuck
5. **Modularity**: Work naturally decomposes into reusable modules
6. **Completion**: Complex tasks actually get finished (not abandoned)

## Open Questions

1. Should we support multiple agents per task-note?
2. Should task status be visible in note content or only metadata?
3. How deep should task hierarchies go?
4. Should we support task templates in the spec note?

## Next Steps

1. **Review** this proposal with the team
2. **Prototype** Phase 1 in a feature branch
3. **User test** with simple task workflows
4. **Iterate** based on feedback
5. **Roll out** phases incrementally

## Feedback

Please provide feedback on:
- Does the note-centric approach feel right?
- Are there use cases this doesn't cover?
- What's the MVP we should target first?
- Should we build Phase 1 first and validate before committing to the full plan?

---

**Last Updated**: 2025-11-22
**Status**: Proposal - Awaiting Review
**Authors**: AI Assistant (with human guidance)
