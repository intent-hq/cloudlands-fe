/**
 * Workspace note comment anchoring MCP tool.
 *
 * Split out of workspace-tools.ts to keep that module as a small export hub.
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import { ToolCall, ToolResult } from './protocol';
import { generateCommentId } from '../../../comments/comment-id-generator';

/**
 * Tool to add comments using text search
 * This tool finds text in the document and anchors comments to it
 */
export class AddNoteCommentTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'add_note_comment',
      `Add a comment to a specific location in a note by searching for text.

HOW IT WORKS:
1. Provide searchContext: a unique phrase from the document (e.g., "## Features\n\nThis section describes the main features")
2. Provide commentTarget: the specific text within that context to anchor the comment to (e.g., "main features")
3. The system finds the context, then anchors the comment to the target within it

TIPS FOR SUCCESS:
- Use enough context to be unique (avoid single words like "the" or "content")
- The target must be a substring of the context
- If you get an error, read the error message carefully - it will tell you exactly what went wrong and how to fix it
- The search is case-sensitive and whitespace-sensitive
- You can use the same text for both context and target if you want to comment on the entire phrase

EXAMPLES:
✅ Good:
  searchContext: "## Features\n\nThis section describes the main features"
  commentTarget: "main features"

✅ Also good (comment on entire phrase):
  searchContext: "More content at the bottom"
  commentTarget: "More content at the bottom"

❌ Bad (too vague):
  searchContext: "features"
  commentTarget: "features"

ERROR HANDLING:
If the search fails, you'll get a detailed error message with:
- What went wrong
- Suggestions for similar text (if applicable)
- Tips on how to fix it
Just read the error and try again!`,
      createInputSchema(
        {
          noteId: stringProperty("The ID of the note (use 'spec' for workspace specification)"),
          comment: stringProperty('The comment text'),
          searchContext: stringProperty(
            'A unique phrase from the document that contains the text you want to comment on. Include enough surrounding text to make it unique.',
          ),
          commentTarget: stringProperty(
            'The specific text within searchContext to anchor the comment to. Must be a substring of searchContext.',
          ),
          author: stringProperty("Optional: Author name (defaults to 'Agent')"),
          type: stringProperty(
            "Optional: 'comment', 'suggestion', 'question', or 'change-request' (default: 'comment')",
          ),
          parentId: stringProperty(
            'Optional: Parent comment ID if this is a reply to another comment',
          ),
          threadId: stringProperty('Optional: Thread ID to group related comments together'),
        },
        ['noteId', 'comment', 'searchContext', 'commentTarget'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const {
        noteId,
        comment,
        searchContext,
        commentTarget,
        author = 'Agent',
        type = 'comment',
        parentId,
        threadId,
      } = call.arguments;

      // Validate inputs
      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        return this.error('Comment text is required and must be non-empty');
      }

      if (
        !searchContext ||
        typeof searchContext !== 'string' ||
        searchContext.trim().length === 0
      ) {
        return this.error('searchContext is required and must be non-empty');
      }

      if (
        !commentTarget ||
        typeof commentTarget !== 'string' ||
        commentTarget.trim().length === 0
      ) {
        return this.error('commentTarget is required and must be non-empty');
      }

      // Get the note
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      const noteContent = note.content || '';
      const updatedAt = note.updatedAt || note.updated_at;

      // Search for the context and target
      const searchResult = this.findAndAnchorText(noteContent, searchContext, commentTarget);

      if (!searchResult.success) {
        // Return detailed error with metadata
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: searchResult.error,
                  message: searchResult.message,
                  details: searchResult.details,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
          metadata: {
            noteId,
            noteUpdatedAt: updatedAt,
            ...searchResult.details,
          },
        };
      }

      // Insert anchors into the document
      const { from, to, anchorIds } = searchResult;

      // TypeScript safety checks (these should never fail due to success check above)
      if (from === undefined || to === undefined || !anchorIds) {
        return this.error('Internal error: missing position or anchor data');
      }

      const beforeAnchor = noteContent.substring(0, from);
      const anchoredText = noteContent.substring(from, to);
      const afterAnchor = noteContent.substring(to);

      const newContent = `${beforeAnchor}<!--anchor:${anchorIds.startId}:start-->${
        anchoredText
      }<!--anchor:${anchorIds.endId}:end-->${afterAnchor}`;

      // Update the note with anchors
      const updateResult = await this.workspaceManager.updateNote({
        workspaceId: this.workspaceId,
        id: noteId,
        content: newContent,
      });

      if (!updateResult || !updateResult.ok) {
        return this.error(
          `Failed to update note with anchors: ${updateResult?.error || 'Unknown error'}`,
        );
      }

      // Add the comment with anchor information
      // IMPORTANT: Use the anchor ID as the comment ID so the frontend can find the anchors
      const commentResult = await this.workspaceManager.addComment({
        workspaceId: this.workspaceId,
        noteId,
        id: anchorIds.startId, // Use anchor ID as comment ID for consistency
        content: comment,
        type,
        author,
        authorType: 'agent',
        from,
        to,
        markId: `${anchorIds.startId}:start|${anchorIds.endId}:end`,
        section: anchoredText, // Store the anchored text so comment manager can find it
        parentId,
        threadId,
      });

      if (commentResult && commentResult.ok) {
        return this.success(
          JSON.stringify(
            {
              success: true,
              message: `Comment successfully anchored to "${anchoredText}"`,
              commentId: commentResult.data.id,
              anchored: true,
              location: {
                line: searchResult.line,
                anchoredText,
              },
            },
            null,
            2,
          ),
          {
            noteId,
            commentId: commentResult.data.id,
            anchoredText,
            line: searchResult.line,
          },
        );
      } else {
        return this.error(`Failed to add comment: ${commentResult?.error || 'Unknown error'}`);
      }
    } catch (error) {
      return this.error(`Failed to add comment: ${(error as Error).message}`);
    }
  }

  /**
   * Find text in document and return anchor positions
   */
  private findAndAnchorText(
    noteContent: string,
    searchContext: string,
    commentTarget: string,
  ): {
    success: boolean;
    from?: number;
    to?: number;
    anchorIds?: { startId: string; endId: string };
    line?: number;
    error?: string;
    message?: string;
    details?: any;
  } {
    // Find all occurrences of searchContext
    const contextMatches = this.findAllOccurrences(noteContent, searchContext);

    if (contextMatches.length === 0) {
      // Context not found - provide suggestions
      const suggestions = this.findSimilarText(noteContent, searchContext, 3);
      return {
        success: false,
        error: 'CONTEXT_NOT_FOUND',
        message: 'Could not find the search context in the document.',
        details: {
          searchedFor: searchContext,
          suggestions,
          tip: 'Check for typos or try a longer, more unique phrase. The search is case-sensitive and whitespace-sensitive.',
        },
      };
    }

    if (contextMatches.length > 1) {
      // Context is ambiguous
      return {
        success: false,
        error: 'CONTEXT_AMBIGUOUS',
        message: 'The search context appears multiple times in the document.',
        details: {
          searchedFor: searchContext,
          matchCount: contextMatches.length,
          matches: contextMatches.slice(0, 5).map((m, i) => ({
            occurrence: i + 1,
            line: m.line,
            context: m.surroundingText,
          })),
          tip:
            contextMatches.length > 5
              ? `Showing first 5 of ${contextMatches.length} matches. Use a longer, more unique phrase that includes surrounding text.`
              : 'Use a longer, more unique phrase that includes surrounding text.',
        },
      };
    }

    // Found unique context - now find target within it
    const contextMatch = contextMatches[0];
    const relativeIndex = searchContext.indexOf(commentTarget);

    if (relativeIndex === -1) {
      // Target not in context
      return {
        success: false,
        error: 'TARGET_NOT_IN_CONTEXT',
        message: 'The comment target was not found within the search context.',
        details: {
          searchContext,
          commentTarget,
          contextFound: true,
          contextLocation: {
            line: contextMatch.line,
            fullText: searchContext,
          },
          tip: 'The comment target must be a substring of the search context. Check for typos.',
        },
      };
    }

    // Check if target appears multiple times in context
    const targetOccurrences = this.countOccurrences(searchContext, commentTarget);
    if (targetOccurrences > 1) {
      // Target is ambiguous within context
      const occurrences = [];
      let searchFrom = 0;
      for (let i = 0; i < targetOccurrences; i++) {
        const idx = searchContext.indexOf(commentTarget, searchFrom);
        if (idx !== -1) {
          const before = searchContext.substring(Math.max(0, idx - 20), idx);
          const after = searchContext.substring(
            idx + commentTarget.length,
            idx + commentTarget.length + 20,
          );
          occurrences.push({
            occurrence: i + 1,
            position: idx,
            surrounding: `${before}[${commentTarget}]${after}`,
          });
          searchFrom = idx + 1;
        }
      }

      return {
        success: false,
        error: 'TARGET_AMBIGUOUS_IN_CONTEXT',
        message: 'The comment target appears multiple times within the search context.',
        details: {
          searchContext,
          commentTarget,
          occurrences,
          tip: "Use a longer target that's unique within the context. For example, include more surrounding words.",
        },
      };
    }

    // Success! Calculate positions
    const from = contextMatch.from + relativeIndex;
    const to = from + commentTarget.length;
    const commentId = this.generateId();

    return {
      success: true,
      from,
      to,
      anchorIds: {
        startId: commentId, // Just the ID, anchor type added in HTML comment
        endId: commentId, // Just the ID, anchor type added in HTML comment
      },
      line: contextMatch.line,
    };
  }

  /**
   * Find all occurrences of text in content
   */
  private findAllOccurrences(
    content: string,
    searchText: string,
  ): Array<{ from: number; to: number; line: number; surroundingText: string }> {
    const matches: Array<{ from: number; to: number; line: number; surroundingText: string }> = [];
    let searchFrom = 0;

    while (true) {
      const index = content.indexOf(searchText, searchFrom);
      if (index === -1) break;

      // Calculate line number
      const beforeText = content.substring(0, index);
      const line = beforeText.split('\n').length;

      // Get surrounding context (50 chars before and after)
      const contextStart = Math.max(0, index - 50);
      const contextEnd = Math.min(content.length, index + searchText.length + 50);
      let surroundingText = content.substring(contextStart, contextEnd);

      // Add ellipsis if truncated
      if (contextStart > 0) surroundingText = `...${surroundingText}`;
      if (contextEnd < content.length) surroundingText = `${surroundingText}...`;

      matches.push({
        from: index,
        to: index + searchText.length,
        line,
        surroundingText,
      });

      searchFrom = index + 1;
    }

    return matches;
  }

  /**
   * Count occurrences of text in content
   */
  private countOccurrences(content: string, searchText: string): number {
    let count = 0;
    let searchFrom = 0;

    while (true) {
      const index = content.indexOf(searchText, searchFrom);
      if (index === -1) break;
      count++;
      searchFrom = index + 1;
    }

    return count;
  }

  /**
   * Find similar text using simple substring matching
   */
  private findSimilarText(content: string, searchText: string, maxResults: number): string[] {
    const suggestions: string[] = [];
    const words = searchText.toLowerCase().split(/\s+/);
    const lines = content.split('\n');

    for (const line of lines) {
      const lineLower = line.toLowerCase();
      // Check if line contains any of the search words
      const matchCount = words.filter((word) => lineLower.includes(word)).length;

      if (matchCount > 0 && matchCount >= words.length * 0.5) {
        // At least 50% of words match
        suggestions.push(line.trim());
        if (suggestions.length >= maxResults) break;
      }
    }

    return suggestions;
  }

  /**
   * Generate a unique ID for comments
   * Uses the shared comment ID generator to ensure consistency
   */
  private generateId(): string {
    return generateCommentId();
  }
}
