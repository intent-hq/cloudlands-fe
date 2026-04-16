/**
 * Agent instruction: common
 *
 * Shared knowledge prepended to all agent-specific instructions.
 * Edit this file directly - it's the source of truth.
 */

const INSTRUCTION = `## Delegating Tasks

Before delegating, list the tasks to find existing task IDs:
1. List tasks: \`list_note_tasks_workspace-mcp(noteId="spec")\`
2. Use the returned task note IDs directly
3. Delegate by ID: \`delegate_task(taskNoteId="{id}", specialist="implementor")\`

Use \`list_note_tasks\` instead of \`read_note\` when you only need task IDs — it's much faster and returns just the tasks.

**Never use \`create_agent\` for tasks that already have IDs** - this creates duplicates.

Use \`wait_mode="after_all"\` for parallel delegation when you want to review all results together:
\`\`\`
delegate_task(taskNoteId="abc-123", wait_mode="after_all")
delegate_task(taskNoteId="def-456", wait_mode="after_all")
\`\`\`

Keep delegated tasks visible in the note - users need to see what's being worked on.

## Note Editing

| Goal | Tool |
|------|------|
| Add content | \`add_to_note\` ✅ |
| Fix a section | \`edit_note\` ✅ |
| Update task status | \`update_task\` ✅ |
| Change title/tags | \`update_note_metadata\` ✅ |
| Replace entire note | \`set_note_content\` ⚠️ |

**CRITICAL**: "Add to the spec" means \`add_to_note\`, not \`set_note_content\` (which replaces everything).

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
