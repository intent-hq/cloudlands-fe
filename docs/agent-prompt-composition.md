# Agent Prompt Composition System

> ⚠️ **DEPRECATION NOTICE**: This document is outdated and may contain inaccurate information.
>
> **For current documentation, see:**
> - [`AGENT_ARCHITECTURE.md`](./AGENT_ARCHITECTURE.md) - Complete agent architecture (v2.5.0+)
> - [`RULES_SYSTEM.md`](./RULES_SYSTEM.md) - Rules and instruction system
>
> **Key differences from this doc:**
> - The main entry point is `buildSystemPrompt()`, not `getSystemPrompt()`
> - System prompts are built in 6 layers (see RULES_SYSTEM.md)
> - The file path is `instruction-service.ts` (hyphen, not dot)

This document describes how agent prompts are composed in the workspaces app.

## Overview

Agent prompts are assembled by the `InstructionService` (`src/features/agent/main/instruction-service.ts`) using a layered composition system. The final prompt is built from base instructions, specialization rules, user rules, and dynamic context.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    InstructionService                           │
│  (src/features/agent/main/instruction-service.ts)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Instruction │  │ Specialists │  │ Dynamic Context         │ │
│  │ Layers      │  │ Service     │  │ (workspace, agent info) │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         └────────────────┼──────────────────────┘               │
│                          ▼                                      │
│              ┌───────────────────────┐                          │
│              │ buildSystemPrompt()   │                          │
│              │ Returns composed      │                          │
│              │ system prompt string  │                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

## Instruction Modules

Located in `src/features/agent/instructions/`, each module exports a default string constant:

| Module | File | Purpose |
|--------|------|---------|
| `core` | `core.ts` | Base agent identity, principles, and behavior |
| `workspace` | `workspace.ts` | Workspace concepts, notes, task blocks, diagrams |
| `implement` | `implement.ts` | Implementation-focused agent instructions |
| `mcp` | `mcp.ts` | MCP tool usage patterns and examples |
| `git` | `git.ts` | Git operations and commit guidelines |
| `delegation` | `delegation.ts` | Task delegation and agent coordination |
| `suggested-prompts` | `suggested-prompts.ts` | How to suggest follow-up prompts |

### Module Loading

The `InstructionService` loads modules via the `loadInstruction()` method:

```typescript
private async loadInstruction(name: string): Promise<string> {
  const module = await import(`../instructions/${name}.ts`);
  return module.default;
}
```

## Specialists System

Specialists are pre-configured agent roles with specific models and behavior prompts.

### Built-in Specialists

Defined in `src/lib/constants/specialists.ts`:

| ID | Name | Default Model | Purpose |
|----|------|---------------|---------|
| `spec-writer` | Coordinator | `opus4.5` | Plans work, delegates to sub-agents, never writes code |
| `implementor` | Implementor | `haiku4.5` | Executes implementation tasks, writes code |
| `verifier` | Verifier | `opus4.5` | Reviews work, verifies completeness |

### Specialist Configuration

Each specialist has:
- `id`: Unique identifier used in API calls
- `name`: Human-readable display name
- `description`: Brief purpose description
- `defaultModel`: Default LLM model to use
- `defaultBehaviorPrompt`: Role-specific instructions appended to system prompt

### User Overrides

Users can customize specialists via the settings UI. Overrides are stored in electron-store:
- `specialists-overrides`: Model and behavior prompt overrides for built-in specialists
- `custom-specialists`: User-defined custom specialists

The `SpecialistsService` (`src/features/agent/main/specialists.service.ts`) merges defaults with user overrides.

## Prompt Composition Flow

### 1. getSystemPrompt() Entry Point

```typescript
async getSystemPrompt(options: SystemPromptOptions): Promise<string>
```

Options include:
- `workspaceId`: Current workspace ID
- `agentId`: Current agent ID
- `specialistId`: Optional specialist to use
- `behaviorPrompt`: Optional custom behavior override
- `includeModules`: Which instruction modules to include

### 2. Module Assembly

The service loads and concatenates instruction modules in order:

```typescript
const sections: string[] = [];

// 1. Core instructions (always included)
sections.push(await this.loadInstruction('core'));

// 2. Workspace instructions (if in workspace context)
if (options.workspaceId) {
  sections.push(await this.loadInstruction('workspace'));
}

// 3. Additional modules based on options
if (options.includeModules?.includes('mcp')) {
  sections.push(await this.loadInstruction('mcp'));
}
// ... etc
```

### 3. Specialist Behavior Injection

If a specialist is specified, its behavior prompt is appended:

```typescript
if (options.specialistId) {
  const specialist = getEffectiveSpecialist(options.specialistId);
  if (specialist) {
    sections.push(specialist.behaviorPrompt);
  }
}
```

### 4. Dynamic Context

Workspace and agent context is injected:

```typescript
sections.push(`## Current Context
- Workspace ID: ${options.workspaceId}
- Agent ID: ${options.agentId}
- Specialist: ${options.specialistId || 'none'}
`);
```

### 5. Final Assembly

All sections are joined with double newlines:

```typescript
return sections.join('\n\n');
```

## Prompt Structure (Final Output)

The composed system prompt follows this structure:

```
# Core Instructions
[Identity, principles, tool usage basics]

# Workspace Instructions
[Notes, task blocks, diagrams, collaboration]

# MCP Instructions (if included)
[Tool patterns, examples]

# Git Instructions (if included)
[Commit guidelines, branch management]

# Specialist Behavior (if specialist assigned)
[Role-specific constraints and workflow]

## Current Context
[Dynamic workspace/agent info]
```

## Key Files

| File | Purpose |
|------|---------|
| `src/features/agent/main/instruction-service.ts` | Main composition logic |
| `src/features/agent/main/specialists.service.ts` | Specialist config with user overrides |
| `src/features/agent/instructions/*.ts` | Instruction modules |
| `src/lib/constants/specialists.ts` | Built-in specialist definitions |
| `src/lib/stores/specialists.store.svelte.ts` | Frontend specialist state |

## Adding New Instructions

1. Create a new file in `src/features/agent/instructions/`:
   ```typescript
   const INSTRUCTION = `# Your Instruction Title

   Your instruction content here...
   `;

   export default INSTRUCTION;
   ```

2. Update `InstructionService` to load the new module when appropriate.

## Adding New Specialists

1. Add to `SPECIALISTS` array in `src/lib/constants/specialists.ts`
2. Update the `Specialist['id']` type union
3. Add expected behaviors in `src/features/agent/testing/specialist-validator.ts`
4. Add icon in `src/lib/components/ui/auggie-avatar/specialist-icons.ts`
