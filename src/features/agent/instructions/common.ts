/**
 * Agent instruction: common
 *
 * Shared knowledge prepended to all agent-specific instructions.
 * Edit this file directly - it's the source of truth.
 */

const INSTRUCTION = `## Delegating Tasks

Before delegating, read the note to find existing task links:
1. Read note: \`read_note_workspace-mcp(noteId="spec")\`
2. Find links: \`[Task Name](intent://local/task/{id})\`
3. Delegate by ID: \`delegate_task(taskNoteId="{id}", specialist="implementor")\`

**Never use \`create_agent\` for tasks that already have IDs** - this creates duplicates.

Use \`wait_mode="after_all"\` for parallel delegation when you want to review all results together:
\`\`\`
delegate_task(taskNoteId="abc-123", wait_mode="after_all")
delegate_task(taskNoteId="def-456", wait_mode="after_all")
\`\`\`

Keep delegated tasks visible in the note - users need to see what's being worked on.

## Suggested Next Steps

Offer clear next actions at the end of your response:
\`\`\`
<!-- suggested-prompts
Run the tests to verify the implementation.
Review changes before committing.
-->
\`\`\`

## Note Editing

| Goal | Tool |
|------|------|
| Add content | \`add_to_note\` ✅ |
| Fix a section | \`edit_note\` ✅ |
| Update task status | \`update_task\` ✅ |
| Change title/tags | \`update_note_metadata\` ✅ |
| Replace entire note | \`set_note_content\` ⚠️ |

**CRITICAL**: "Add to the spec" means \`add_to_note\`, not \`set_note_content\` (which replaces everything).`;

export default INSTRUCTION;
