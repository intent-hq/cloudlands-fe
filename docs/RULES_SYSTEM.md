# Rules System Architecture

The Intent app uses a sophisticated multi-layer system for building agent system prompts. The central service is `InstructionService` (backend only).

## System Prompt Layers

When an agent is created, its system prompt is assembled from 6 layers (with sub-layers):

| Layer | Source | Description |
|-------|--------|-------------|
| **1. Base System Prompt** | `base-system-prompt.ts` or user override | Core identity and behavior for all agents |
| **2. Behavior Instructions** | `behaviorPrompt` parameter | Specialist role definition (placed early for primacy) |
| **3. Specialization Rules** | Agent-type specific instructions | Type-specific behavior (investigate, implement, etc.) |
| **3.5. Specialist Config** | `specialists.service.ts` | Available specialists and their current models |
| **4. User Rules** | CLAUDE.md, AGENTS.md, .augment/guidelines.md, .augment/rules/ | Project-level rules from the workspace |
| **4.5. Workspace Context** | Open panels + linked references | Current workspace state visible to agent |
| **5. Runtime Context** | contextReferences parameter | Dynamic context passed at agent creation |
| **6. Mandatory Actions** | Agent-type footer | Critical first steps for certain agents (e.g., new-workspace) |

**Note**: Behavior instructions are placed early (Layer 2) for maximum primacy - LLMs pay more attention to early content.

## 3-Tier Fallback for Specialization Rules

For Layer 3 (specialization rules), there's a 3-tier fallback:

1. **EndUserRulesManager** (electron-store) - User customizations via UI
2. **Workspace files** (`.augment/agent-rules/{agentType}.md`) - Per-workspace overrides
3. **Bundled defaults** (TypeScript constants) - Built-in instructions

## Common Instructions

All agent-specific instructions get `common.ts` (~326 lines) prepended, providing shared knowledge about:

- Self-identification (naming the agent)
- Markdown features (task lists, choice blocks, note links, @ mentions)
- ws-block primitives (reference, cli, patch, agent_action)
- Working with the spec
- Spawning sub-tasks
- Agent digest format
- Best practices

## Key Files

| File | Purpose |
|------|---------|
| `src/features/agent/main/instruction-service.ts` | Central service that builds system prompts |
| `src/features/agent/instructions/index.ts` | Exports all instructions, provides `getInstructionById()` |
| `src/features/agent/instructions/common.ts` | Shared knowledge prepended to all agent instructions |
| `src/features/agent/instructions/base-system-prompt.ts` | Foundation for all agents (Layer 1) |
| `src/features/agent/instruction-registry.ts` | Frontend registry for UI display |
| `src/features/agent/main/rules-loader.ts` | Loads user rules from workspace |

---

# Agent Types

## Core Spec-Focused Agents

| Type | Purpose | Lines |
|------|---------|-------|
| **investigate** | Analyze specs, assess feasibility, provide feedback | ~99 |
| **implement** | Execute plans, report progress, stop on blockers | ~172 |
| **verify** | Check implementation matches spec, run tests | ~228 |
| **critique** | Review specs for feasibility and technical merit | ~132 |
| **debug** | Echo context for debugging agent launch system | ~177 |
| **handle-selection** | Process selected text from editor | ~64 |
| **respond-to-comments** | Address open comments on notes | ~382 |

## Task-Oriented Agents

| Type | Purpose | Lines |
|------|---------|-------|
| **task-focused** | Complete specific tasks with good judgment | ~179 |
| **task-breakdown** | Decompose complex tasks into subtasks | ~206 |
| **task-loop** | Task sessions with shared markdown note | ~144 |
| **task-debug** | Debug task-to-agent integration | ~101 |

## Workspace Agents

| Type | Purpose | Lines |
|------|---------|-------|
| **new-workspace** | First agent in new workspace | ~129 |
| **workspace-agent** | General workspace operations | ~83 |

## Background Agents

| Type | Purpose | Lines |
|------|---------|-------|
| **code-review** | Automated code reviews | ~93 |
| **commit-message** | Generate commit messages | ~91 |
| **pr-description** | Generate PR descriptions | ~78 |

## Utility

| Type | Purpose |
|------|---------|
| **chat** | General chat interface |
| **notes-system-guide** | Documentation about the notes system |

## Aliases

- `refactor` → `implement`
- `fix` → `debug`
- `test` → `implement`
- `docs` → `implement`
- `review` → `code-review`

---

# What Rules Each Agent Receives

## All Agents Get:

1. **Base System Prompt** (~65 lines) - Core identity, principles, tool usage
2. **User Rules** (if present) - From CLAUDE.md, AGENTS.md, or .augment/rules/
3. **Common Instructions** (~326 lines) - Shared knowledge (prepended to specialization)
4. **Specialization** - Agent-type specific instructions

## Total Approximate Sizes:

| Agent Type | Common + Specialization |
|------------|-------------------------|
| investigate | ~425 lines |
| implement | ~498 lines |
| verify | ~554 lines |
| critique | ~458 lines |
| respond-to-comments | ~708 lines |
| task-focused | ~505 lines |
| task-breakdown | ~532 lines |
| new-workspace | ~455 lines |

---

# Customizing Rules

## User-Level (via UI)
- Use `EndUserRulesManager` to set custom rules per agent type
- Stored in electron-store, persists across sessions

## Workspace-Level
- Create `.augment/agent-rules/{agentType}.md` files
- These override bundled defaults for that workspace

## Project-Level
- Create `CLAUDE.md`, `AGENTS.md`, or `.augment/guidelines.md` in workspace root
- Or use `.augment/rules/` directory with multiple `.md` files
- Supports YAML frontmatter: `type: always_apply | agent_requested`

---

# Agent Behavior Details

## investigate

**Purpose**: Explore codebase and assess feasibility before implementation.

**Key behaviors**:
- Reads the spec note first
- Explores codebase to understand integration points
- Provides feedback as comments on the spec
- Identifies risks and unknowns
- Does NOT write code

## implement

**Purpose**: Execute implementation plans from the spec.

**Key behaviors**:
- Follows the spec strictly
- Reports progress in the spec
- Stops when blocked and asks for decisions
- Checks off completed tasks
- Handles refactor, test, docs work (via aliases)

## verify

**Purpose**: Check that implementation matches the spec.

**Key behaviors**:
- Runs existing tests
- Checks completeness against spec
- Documents any deviations
- Provides verification report with recommendations
- Does NOT fix issues (reports them)

## critique

**Purpose**: Review specs for feasibility and quality.

**Key behaviors**:
- Evaluates technical merit
- Identifies risks and edge cases
- Suggests improvements
- Considers maintainability
- Provides structured feedback

## respond-to-comments

**Purpose**: Address open comments on notes.

**Key behaviors**:
- Queries threads needing responses (user commented last)
- Prioritizes: questions → change requests → suggestions → comments
- Uses codebase context in responses
- Maintains thread structure
- Updates comment status appropriately

## new-workspace

**Purpose**: Initialize a new workspace.

**Key behaviors**:
- FIRST ACTION: Rename the workspace
- Works with spec to define project
- Proposes major workstreams (2-4 tasks)
- Asks clarifying questions
- Does NOT write code until ready

## task-focused

**Purpose**: Complete specific assigned tasks.

**Key behaviors**:
- Analyzes task scope and complexity
- Executes directly if small enough
- Breaks down if too large
- Updates task status when complete
- Uses good judgment on approach

## task-breakdown

**Purpose**: Decompose complex tasks.

**Key behaviors**:
- Researches context first
- Creates appropriately-sized subtasks
- Validates subtasks cover full scope
- Updates parent document with subtasks
- Does NOT execute (just plans)

## Background Agents

**code-review**: Reviews changes with categories (critical, important, suggestion, nitpick)

**commit-message**: Follows conventional commits format (feat, fix, docs, etc.)

**pr-description**: Creates structured PR descriptions with Summary, Changes, Motivation, Testing sections

---

# Caching

The instruction service uses caching for performance:

| Cache | TTL | Purpose |
|-------|-----|---------|
| Specialization Rules | 5 min | Per agent-type instructions |
| Full System Prompts | 30 sec | Complete assembled prompts |
| User Rules | Until file change | Workspace rule files (watched) |

File watching automatically invalidates caches when workspace files change.
