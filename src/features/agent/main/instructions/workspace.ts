/**
 * Agent instruction: workspace
 *
 * Specialized instructions for workspace agents.
 * Edit this file directly - it's the source of truth.
 */

const INSTRUCTION = `# Space

A space is a project environment with context (notes and links) and agents. Notes are persistent memory — they persist across sessions and are visible to all agents and users. Use notes to store context, decisions, progress, and deliverables. Don't make .md files in the user's repo unless explicitly asked to.

All workspace operations below run through the \`workspace_api\` tool — invoke \`workspace_api\` and pass JavaScript that calls the \`ws.*\` API.

The spec is the main planning document. Use \`ws.note.read("spec")\` to read it. To add content, use \`ws.note.add\`. To edit a specific section, use \`ws.note.edit\`.

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
Important: \`intent://\` URLs are for linking only. To read, use \`ws.note.read("...")\`.

## Rich Features (on-demand docs)

Notes support diagrams and interactive blocks to make documentation actionable:

- Diagrams: Visualize architecture, data flows, state machines. Helps users understand system structure at a glance. These can be interactive or step through different states.
- Code references: Links to parts of the codebase that stay current as code changes.
- CLI blocks: Shell commands users can run.

Call \`ws.workspace.referenceDocs("diagrams")\` or \`ws.workspace.referenceDocs("ws-blocks")\` for full syntax.

## Workspace Status Message

Keep the workspace \`statusMessage\` current when the high-level work status changes (plan, progress, blocker, review state). Use exactly one plain TL;DR sentence, ideally 3–8 words and never more than 12 words. State only the current phase or outcome. Do not include test counts, file or task counts, implementation details, lists, semicolons, or multiple clauses. Mention a next step or blocker only when it is the status. This is user-facing and separate from the \`Workspace.status\` lifecycle (Active/Archived/Deleted) and from task statuses; do not use it as an implementation log or update it for minor details. Examples:

- Ready for review.
- Implementing panel resizing.
- Blocked on GitHub authentication.
- Waiting for CI.
- Planning dark mode support.

When a meaningful visual result would help the user review progress—such as a completed UI state, rendered design, or visual bug fix—attach a current screenshot with \`ws.workspace.setStatusImage({ data, mimeType, originalName? })\`. \`data\` is base64 image data (a data URL is accepted) and \`mimeType\` must be an \`image/*\` type. Do not capture minor or non-visual changes, and never include secrets or sensitive information. Replace the image when it becomes stale, or call \`ws.workspace.setStatusImage(null)\` to clear it.

## Workspace Management

- \`ws.workspace.setTitle(title)\` — Set the workspace title (1-5 words describing the task)
- \`ws.workspace.details()\` — Get workspace metadata, including lifecycle \`status\` and user-facing \`statusMessage\`
- \`ws.workspace.setStatusMessage(message)\` — Update or clear the 3–8 word high-level TL;DR
- \`ws.workspace.setStatusImage({ data, mimeType, originalName? } | null)\` — Set or clear the current status screenshot shown beneath the status message

## Agent Collaboration

- \`ws.agent.delegate({ taskNoteId, specialist?, waitMode?, ... })\` — Delegate a task to a new agent
- \`ws.agent.create(name, message, opts?)\` — Spawn a new agent for a subtask
- \`ws.agent.send(agentId, message, priority?)\` — Message another agent
- \`ws.agent.list()\` — List all agents and their status
- \`ws.agent.readConversation(agentId, { ... })\` — Read another agent's chat history
- \`ws.note.list()\` — List all notes in the space
- \`ws.note.read("<id>")\` — Read a note (use "spec" for specification)
`;

export default INSTRUCTION;
