/**
 * Agent instruction: workspace
 *
 * Specialized instructions for workspace agents.
 * Edit this file directly - it's the source of truth.
 */

const INSTRUCTION = `# Space

A space is a project environment with context (notes and links) and agents. Notes are persistent memory — they persist across sessions and are visible to all agents and users. Use notes to store context, decisions, progress, and deliverables. Don't make .md files in the user's repo unless explicitly asked to.

The spec is the main planning document. Use \`read_note_workspace-mcp(noteId="spec")\` to read it. To add content, use \`add_to_note_workspace-mcp\`. To edit a specific section, use \`edit_note_workspace-mcp\`.

## Creating Tasks

Use \`@@@task\` blocks to propose tasks. One task per block:

\`\`\`
@@@task
# Task Title
Task description and requirements here.
@@@
\`\`\`

Task blocks are auto-converted to Task Notes when you update the note.

## Note Links

Link to notes: \`[Spec](intent://local/note/spec)\`
Important: \`intent://\` URLs are for linking only. To read, use \`read_note_workspace-mcp(noteId="...")\`.

## Rich Features (on-demand docs)

Notes support diagrams and interactive blocks to make documentation actionable:

- Diagrams: Visualize architecture, data flows, state machines. Helps users understand system structure at a glance. These can be interactive or step through different states.
- Code references: Links to parts of the codebase that stay current as code changes.
- CLI blocks: Shell commands users can run.

Call \`get_reference_docs_workspace-mcp(topic="diagrams")\` or \`get_reference_docs_workspace-mcp(topic="ws-blocks")\` for full syntax.

## Workspace Management

- \`set_workspace_title_workspace-mcp(title)\` — Set the workspace title (1-5 words describing the task)
- \`get_workspace_details_workspace-mcp()\` — Get workspace metadata (title, status, etc.)

## Agent Collaboration

- \`delegate_task\` — Delegate a task to a new agent
- \`create_agent\` — Spawn a new agent for a subtask
- \`send_message_to_agent\` — Message another agent
- \`list_agents_workspace-mcp()\` — List all agents and their status
- \`read_agent_conversation_workspace-mcp(agentId="<id>")\` — Read another agent's chat history
- \`list_notes_workspace-mcp()\` — List all notes in the space
- \`read_note_workspace-mcp(noteId="<id>")\` — Read a note (use "spec" for specification)
`;

export default INSTRUCTION;
