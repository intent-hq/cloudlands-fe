/**
 * Reference documentation for on-demand retrieval by agents.
 * These docs are returned by the GetReferenceDocsTool when agents need detailed syntax.
 */

export const REFERENCE_DOCS: Record<string, string> = {
  diagrams: `# Diagram Syntax Reference

Create interactive diagrams in notes using \`\`\`diagram code blocks with JSON inside.

## Basic Structure

\`\`\`diagram
{
  "id": "unique-id",
  "type": "diagram",
  "version": 1,
  "createdAt": "2024-01-01T00:00:00Z",
  "createdBy": "agent",
  "grammar": "architecture",
  "model": {
    "nodes": [
      {"id": "client", "label": "Client", "kind": "actor"},
      {"id": "api", "label": "API", "kind": "service"}
    ],
    "edges": [
      {"id": "e1", "from": "client", "to": "api", "label": "HTTP"}
    ]
  },
  "baseView": {
    "layout": {"type": "layered", "direction": "LR"}
  }
}
\`\`\`

## Grammars

- \`architecture\` - System architecture, services, components
- \`flowchart\` - Process flows, decision trees
- \`state_machine\` - State transitions, FSMs
- \`sequence\` - Interaction sequences, message flows
- \`data_flow\` - Data pipelines, transformations
- \`network\` - Network topology, connections
- \`timeline\` - Events over time, chronology
- \`dependency_graph\` - Dependencies, build graphs

## Layouts

- \`"type": "layered"\` - **PREFERRED**. Use \`"direction": "TB"\` (vertical) or \`"LR"\` (horizontal)
- \`"type": "force"\` - Physics-based. Only for cyclic graphs or non-hierarchical networks
- \`"spacing": 120\` - Increase for complex diagrams (default: 80-100)
- \`"edgeRouting": "orthogonal"\` - Clean right-angle edges

## Bindings (make elements clickable)

Add to nodes or edges:
- \`{"type": "file", "target": "path/to/file.ts"}\` - Opens file
- \`{"type": "symbol", "target": "path/to/file.ts#symbol:ClassName"}\` - Navigates to symbol
- \`{"type": "note", "target": "note-id"}\` - Opens note

## States (multi-step walkthroughs)

Add \`"states": [...]\` array:
- \`"id"\` - Unique state ID
- \`"narrative"\` - Explanation text
- \`"highlightedNodes"\` / \`"highlightedEdges"\` - Elements to highlight
- \`"visibleNodes"\` / \`"visibleEdges"\` - Show ONLY these elements

## Edge Styles

- \`"animated": true\` - Animated flow
- \`"dashed": true\` - Dashed line

## Semantic Styles

\`"semanticStyle": "highlighted" | "muted" | "danger" | "success" | "warning" | "inactive" | "active"\`

## Best Practices

1. Use layered layout for hierarchical systems
2. Group related nodes with \`groups\`
3. Keep it simple: 5-15 nodes ideal
`,

  'ws-blocks': `# Rich Blocks (ws-blocks) Reference

Embed interactive blocks in notes using the \`workspace_api\` tool or markdown syntax.

## API Calls (via the \`workspace_api\` tool)

- \`ws.primitive.addReference(noteId, semanticId, description, snapshot?)\` - Live code reference
- \`ws.primitive.addCli(noteId, command, description, workingDirectory?)\` - Runnable command
- \`ws.primitive.addPatch(noteId, filePath, diff, description)\` - Applyable code change
- \`ws.primitive.addAgentAction(noteId, agentId, goal, description)\` - Agent trigger button

## Markdown Syntax

Write directly using \`\`\`ws-block:{type} fences:

### Reference Block (code link)

\`\`\`ws-block:reference
{
  "id": "uuid-here",
  "version": 1,
  "type": "reference",
  "createdAt": "2024-01-01T00:00:00Z",
  "createdBy": "agent",
  "target": {
    "semanticId": "src/file.ts#symbol:ClassName.method",
    "description": "Description of what this references"
  }
}
\`\`\`

### CLI Block (runnable command)

\`\`\`ws-block:cli
{
  "id": "uuid-here",
  "version": 1,
  "type": "cli",
  "createdAt": "2024-01-01T00:00:00Z",
  "createdBy": "agent",
  "command": "npm run test",
  "description": "Run the test suite"
}
\`\`\`

### Patch Block (code diff)

\`\`\`ws-block:patch
{
  "id": "uuid-here",
  "version": 1,
  "type": "patch",
  "createdAt": "2024-01-01T00:00:00Z",
  "createdBy": "agent",
  "filePath": "src/component.tsx",
  "diff": "--- a/src/component.tsx\\n+++ b/src/component.tsx\\n@@ -1,3 +1,4 @@\\n+import { newDep } from 'lib';\\n import React from 'react';",
  "description": "Add new import"
}
\`\`\`

### Agent Action Block (trigger button)

\`\`\`ws-block:agent_action
{
  "id": "uuid-here",
  "version": 1,
  "type": "agent_action",
  "createdAt": "2024-01-01T00:00:00Z",
  "createdBy": "agent",
  "goal": "Refactor this component to use hooks",
  "description": "Click to start refactoring"
}
\`\`\`

## Block Types Summary

| Type | Purpose |
|------|---------|
| \`reference\` | Clickable code symbol link |
| \`cli\` | Runnable shell command |
| \`patch\` | Applyable code diff |
| \`agent_action\` | Button to trigger agent work |
`,

  tasks: `# Task Block Syntax Reference

Use \`@@@task\` blocks to propose tasks that become Task Notes.

## Syntax

\`\`\`
@@@task
# Task Title
Task description, requirements, and context.

## Subsection
More details...
@@@
\`\`\`

## Key Rules

1. **One task per block** - Each \`@@@task\` block contains exactly one task
2. **First \`#\` heading is the title** - The first h1 heading becomes the task title
3. **Everything below is the body** - All content after the title becomes the task body
4. **Auto-conversion** - Task blocks are converted to Task Notes when the note is updated

## Example (multiple tasks)

\`\`\`
@@@task
# Authentication System
Build JWT-based authentication for the API layer.

## Requirements
- Login/logout endpoints
- Session management with refresh tokens
@@@

@@@task
# Database Layer
Set up PostgreSQL with Drizzle ORM.

## Schema
- Users table
- Sessions table
@@@
\`\`\`

## After Conversion

Each \`@@@task\` block is replaced with a linked checkbox:
\`- [ ] [Task Title](intent://local/task/{id})\`

You can then delegate these tasks via the \`workspace_api\` tool using \`ws.agent.delegate({ taskNoteId: "..." })\`.
`,
};

export const AVAILABLE_TOPICS = Object.keys(REFERENCE_DOCS);
