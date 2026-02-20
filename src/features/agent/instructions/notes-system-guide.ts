/**
 * Agent instruction: notes-system-guide
 *
 * Comprehensive guide for working with notes and comments.
 */

const INSTRUCTION = `# Notes System Guide

Notes are markdown documents for specs, plans, and documentation. The spec (ID: "spec") is the main planning document.

## Key Tools

### Reading Notes
- \`read_note_workspace-mcp(noteId)\` — Read a note (use "spec" for the specification)
- \`list_notes_workspace-mcp()\` — List all notes

### Editing Notes (Choose the Right Tool!)

**SAFE tools (preserves existing content):**
- \`add_to_note_workspace-mcp(noteId, content, heading?, position?)\` — **SAFEST**: Add content (default: end)
  - position: "end" (default), "start", or "after:## Heading"
- \`edit_note_workspace-mcp(noteId, old_text, new_text)\` — Surgical str_replace style editing
- \`edit_note_lines_workspace-mcp(noteId, start_line, end_line, new_content)\` — Line-based editing
- \`update_note_metadata_workspace-mcp(noteId, title?, tags?)\` — Update only title/tags
- \`update_task_workspace-mcp(noteId, taskLine, newStatus)\` — Update a single task status

**DANGEROUS tools (full replacement):**
- \`set_note_content_workspace-mcp(noteId, content)\` — ⚠️ **REPLACES ENTIRE NOTE** - requires confirmation!

### Creating/Deleting Notes
- \`create_note_workspace-mcp(title, content)\` — Create a new note
- \`delete_note_workspace-mcp(noteId)\` — Delete a note

### When to Use Each Editing Tool
| User Request | Use This Tool |
|--------------|---------------|
| "Add this to the spec" | \`add_to_note\` |
| "Put this information in the note" | \`add_to_note\` |
| "Insert after Phase 1" | \`add_to_note(position="after:## Phase 1")\` |
| "Fix this typo" | \`edit_note\` |
| "Update lines 5-10" | \`edit_note_lines\` |
| "Change the title" | \`update_note_metadata\` |
| "Mark task as done" | \`update_task\` |
| "Rewrite the entire spec" | \`set_note_content\` (requires confirm_replacement="true") |

## Comments

Use \`add_note_comment_workspace-mcp\` to comment on specific text:
- \`searchContext\`: A unique phrase from the document
- \`commentTarget\`: The specific text within that context to anchor to

Use \`list_note_comments_workspace-mcp\` to see threads, \`respond_to_comment_thread_workspace-mcp\` to reply.

## Tips

- Always read before updating to avoid overwriting changes
- Prefer \`add_to_note\` and \`edit_note\` over \`set_note_content\`
- Use \`intent://local/note/{noteId}\` links to reference notes
- Use tags to organize notes
`;

export default INSTRUCTION;
