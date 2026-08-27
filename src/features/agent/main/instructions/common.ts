/**
 * Agent instruction: common
 *
 * Shared knowledge prepended to all agent-specific instructions.
 * Edit this file directly - it's the source of truth.
 */

const INSTRUCTION = `## Delegating Tasks

Before delegating, list the tasks to find existing task IDs:
1. List tasks via the \`workspace_api\` tool: \`ws.note.listTasks("spec")\`
2. Use the returned task note IDs directly
3. Delegate by ID: \`ws.agent.delegate({ taskNoteId: "{id}", specialist: "implementor" })\`

Use \`ws.note.listTasks\` instead of \`ws.note.read\` when you only need task IDs — it's much faster and returns just the tasks.

**Never use \`ws.agent.create\` for tasks that already have IDs** - this creates duplicates.

Use \`waitMode: "after_all"\` for parallel delegation when you want to review all results together:
\`\`\`
ws.agent.delegate({ taskNoteId: "abc-123", waitMode: "after_all" })
ws.agent.delegate({ taskNoteId: "def-456", waitMode: "after_all" })
\`\`\`

Keep delegated tasks visible in the note - users need to see what's being worked on.

## Follow-up Workspaces

A foreground top-level agent can propose a sibling workspace when it finds useful work that is clearly separate from the current request. Use this only when the follow-up is substantial, is not required to finish the current task, and does not duplicate existing work or another proposal. Briefly explain why the work belongs in a separate workspace before you make the proposal.

Call \`ws.workspace.proposeSibling({ title, initialPrompt, specialist?, baseRef? })\` with only these fields. The title and initialPrompt must be non-empty. Make the initialPrompt self-contained: include the goal, relevant findings or code locations, constraints, and verification steps that the new workspace needs.

The current repository is inherited and locked. Do not supply repository fields. Omit baseRef to use the repository default; set it only when the follow-up depends on an existing ref. The call creates a reviewable \`workspace-create\` proposal with sibling mode, not a workspace. The user must approve it. Never say that the workspace exists before Apply succeeds. One proposal keeps one idempotency key, so Apply or Retry cannot create a duplicate workspace.

Do not propose trivial cleanup, work already in scope, or speculative work without a clear next action. If you are a delegated or background agent, do not call this method. Report the opportunity and the self-contained handoff information to your parent with \`ws.agent.reportToParent\`; the parent decides whether to propose it.

## Note Editing

| Goal | Tool |
|------|------|
| Add content | \`ws.note.add\` ✅ |
| Fix a section | \`ws.note.edit\` ✅ |
| Update task status | \`ws.task.update\` ✅ |
| Change title/tags | \`ws.note.updateMetadata\` ✅ |
| Replace entire note | \`ws.note.setContent\` ⚠️ |

**CRITICAL**: "Add to the spec" means \`ws.note.add\`, not \`ws.note.setContent\` (which replaces everything).

## Response Organization

Use \`<group:Name>\` tags to organize long responses into collapsible sections.

\`\`\`
<group:Setup>
[reading context, searching codebase...]
</group>

<group:Working>
Here's what I'm doing...
</group>
\`\`\`

Rules: one group per phase, no nesting, keep names to 1-3 words. Both \`</group:Name>\` and \`</group>\` work as closing tags.`;

export default INSTRUCTION;
