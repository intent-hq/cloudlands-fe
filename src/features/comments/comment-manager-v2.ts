/**
 * Comment Manager V2
 *
 * Manages comments using anchor nodes instead of marks.
 * Provides a clean separation between document structure and comment data.
 */

import type { Editor } from '@tiptap/core';
import { commentsStoreV2, type CommentV2, type CommentAnchor } from './comments-v2.store.svelte';
import { createLogger } from '$lib/utils/client-logger';
import { findCommentAnchors, getAllAnchoredCommentIds } from '$lib/components/tiptap/CommentAnchor';
import { updateCommentDecorations } from '$lib/components/tiptap/CommentDecorations';
import {
  loadComments as loadCommentsFromBackend,
  addComment as addCommentToBackend,
  resolveComment as resolveCommentInBackend,
  replyToComment as replyToCommentInBackend,
} from './comment-loader';
import type { NoteVersion } from '../../shared/types';
import { convertBackendCommentToV2 } from './comment-types-v2';

const logger = createLogger('CommentManagerV2');

/**
 * Result of anchor recovery attempt
 */
export interface RecoveryResult {
  success: boolean;
  method?: 'exact-match' | 'fuzzy-match' | 'context-match';
  confidence: number;
  reason?: 'text-not-found' | 'no-version-history' | 'never-healthy';
  savedAfterRecovery?: boolean;
}

export class CommentManagerV2 {
  private editor: Editor | null = null;
  private workspaceId: string;
  private noteId: string;
  private isInitialized = false;
  private isInsertingAnchors = false;
  public onContentChanged?: () => void | Promise<void>;
  private anchorInsertionAttempts = new Map<string, number>(); // Track failed attempts per comment
  private readonly MAX_ANCHOR_ATTEMPTS = 2; // Maximum attempts to insert anchors for a comment
  private orphanCheckTimeout: NodeJS.Timeout | null = null; // Debounce orphan checks

  constructor(
    workspaceId: string,
    noteId: string,
    options?: { onContentChanged?: (recoveryTimestamp?: string) => void | Promise<void> },
  ) {
    this.workspaceId = workspaceId;
    this.noteId = noteId;
    this.onContentChanged = options?.onContentChanged;
  }

  /**
   * Initialize the comment manager with an editor instance
   */
  async initialize(editor: Editor) {
    this.editor = editor;

    // Load existing comments
    await this.loadComments();

    // Update decorations
    this.updateDecorations();

    // Set up editor transaction listener
    this.setupEditorListeners();

    this.isInitialized = true;
    logger.info('Comment manager initialized', {
      workspaceId: this.workspaceId,
      noteId: this.noteId,
    });
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Clear any pending timeouts
    if (this.orphanCheckTimeout) {
      clearTimeout(this.orphanCheckTimeout);
      this.orphanCheckTimeout = null;
    }

    this.editor = null;
    this.isInitialized = false;
    this.isInsertingAnchors = false;
    this.anchorInsertionAttempts.clear();

    logger.info('Comment manager destroyed');
  }

  /**
   * Load comments from backend
   */
  private async loadComments() {
    try {
      const backendComments = await loadCommentsFromBackend({
        workspaceId: this.workspaceId,
        noteId: this.noteId,
      });

      logger.info('Loading comments from backend', {
        count: backendComments.length,
        firstComment: backendComments[0],
      });

      // Convert backend comments to V2 format using type-safe helper
      const v2Comments: CommentV2[] = backendComments.map((comment) => {
        // Determine anchor type based on comment data
        let anchor: CommentAnchor;

        logger.debug('Processing comment', {
          id: comment.id,
          markId: comment.markId,
          from: comment.from,
          to: comment.to,
        });

        if (comment.markId) {
          // Parse existing anchor IDs from markId
          // Format is either "id:start|id:end" for range or "id:point" for point
          if (comment.markId.includes('|')) {
            // Range comment with format "id:start|id:end"
            const [startId, endId] = comment.markId.split('|');
            anchor = {
              type: 'range',
              startId: startId || `${comment.id}:start`,
              endId: endId || `${comment.id}:end`,
            };
          } else {
            // Point comment with format "id:point"
            anchor = {
              type: 'point',
              pointId: comment.markId || `${comment.id}:point`,
            };
          }
        } else if (
          comment.from !== undefined &&
          comment.to !== undefined &&
          comment.from !== comment.to
        ) {
          // Range comment
          anchor = {
            type: 'range',
            startId: `${comment.id}:start`,
            endId: `${comment.id}:end`,
          };
        } else {
          // Point comment
          anchor = {
            type: 'point',
            pointId: `${comment.id}:point`,
          };
        }

        // Use type-safe conversion helper with runtime validation
        try {
          return convertBackendCommentToV2(comment, anchor, this.noteId);
        } catch (error) {
          // Log error but don't fail the entire load - just skip this comment
          logger.error('Failed to convert comment, skipping', {
            commentId: comment.id,
            type: comment.type,
            error,
          });
          // Return a fallback regular comment to avoid breaking the UI
          return {
            id: comment.id,
            threadId: comment.threadId || `thread-${comment.id}`,
            content: comment.content || '[Error loading comment]',
            type: 'comment' as const,
            author: comment.author || 'Unknown',
            authorType: comment.authorType || 'user',
            status: comment.status || 'open',
            createdAt: comment.createdAt || new Date().toISOString(),
            updatedAt: comment.updatedAt || new Date().toISOString(),
            parentId: comment.parentId,
            noteId: this.noteId,
            anchor,
            anchorText: comment.section,
            anchorContext: undefined, // NoteComment doesn't have anchorContext
            reactions: comment.reactions
              ? Object.fromEntries(
                Object.entries(comment.reactions).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? (v as string[]) : [v as string],
                ]),
              )
              : undefined,
          };
        }
      });

      commentsStoreV2.loadComments(v2Comments);
      logger.info('Loaded comments from backend', { count: v2Comments.length });

      // After loading comments, we need to insert anchors into the document
      // and update decorations for visual highlighting
      if (this.editor && v2Comments.length > 0) {
        // Clear previous attempts for a fresh start
        this.anchorInsertionAttempts.clear();

        // Wait a bit for the editor content to be ready
        setTimeout(async () => {
          if (this.editor) {
            await this.insertAnchorsForLoadedComments(v2Comments);
            this.updateDecorations();
          }
        }, 200);
      }
    } catch (error) {
      logger.error('Failed to load comments', error);
    }
  }

  /**
   * Insert anchors for comments loaded from backend
   */
  private async insertAnchorsForLoadedComments(comments: CommentV2[], retryCount = 0) {
    if (!this.editor) return;

    // Prevent duplicate calls
    if (this.isInsertingAnchors) {
      logger.debug('Already inserting anchors, skipping duplicate call');
      return;
    }

    // Maximum retry attempts to prevent infinite loops - REDUCED to prevent hanging
    const MAX_RETRIES = 2;

    // Check if we've exceeded max retries first
    if (retryCount >= MAX_RETRIES) {
      logger.warn('Max retries reached for inserting anchors, giving up', {
        commentCount: comments.length,
        retryCount,
      });
      return;
    }

    // Check if editor is ready - isDestroyed might be true during reinitialization
    // so we only check if it's editable and has a valid view
    if (!this.editor.isEditable || !this.editor.view) {
      logger.debug('Editor not ready for anchor insertion, will retry', {
        isEditable: this.editor.isEditable,
        hasView: !!this.editor.view,
        retryCount,
      });

      // Retry after a longer delay to give editor time to initialize
      setTimeout(() => {
        this.insertAnchorsForLoadedComments(comments, retryCount + 1);
      }, 500); // Increased delay
      return;
    }

    logger.debug('Inserting anchors for loaded comments', {
      count: comments.length,
      editorReady: !!this.editor,
      hasContent: this.editor?.state.doc.textContent.length > 0,
    });

    // Make sure editor has content
    if (!this.editor.state.doc.textContent || this.editor.state.doc.textContent.length === 0) {
      // Only retry once for empty content
      if (retryCount === 0) {
        logger.debug('Editor has no content yet, will retry once', {
          retryCount,
        });

        // Retry after a longer delay
        setTimeout(() => {
          this.insertAnchorsForLoadedComments(comments, retryCount + 1);
        }, 1000); // Increased delay
      } else {
        logger.warn('Editor still has no content, giving up anchor insertion', {
          retryCount,
        });
      }
      return;
    }

    // Set flag to prevent duplicate calls
    this.isInsertingAnchors = true;

    for (const comment of comments) {
      try {
        logger.info('Processing comment for anchor insertion', {
          commentId: comment.id,
          hasAnchorText: !!comment.anchorText,
          anchorText: comment.anchorText?.substring(0, 100),
          anchorType: comment.anchor?.type,
          fullComment: comment,
        });

        // Skip if anchors already exist in document
        const existingAnchors = findCommentAnchors(this.editor.state.doc, comment.id);
        if (
          existingAnchors.start !== undefined ||
          existingAnchors.end !== undefined ||
          existingAnchors.point !== undefined
        ) {
          logger.debug('Anchors already exist for comment', {
            commentId: comment.id,
            existingAnchors,
          });
          continue;
        }

        // Check if we've already tried too many times for this comment
        const attempts = this.anchorInsertionAttempts.get(comment.id) || 0;
        if (attempts >= this.MAX_ANCHOR_ATTEMPTS) {
          logger.debug('Skipping anchor insertion - max attempts reached', {
            commentId: comment.id,
            attempts,
          });
          continue;
        }

        // Try to find the text that the comment refers to
        if (!comment.anchorText) {
          // Track failed attempt
          this.anchorInsertionAttempts.set(comment.id, attempts + 1);

          // Only warn on first attempt to reduce log spam
          if (attempts === 0) {
            logger.warn('Comment has no anchor text, cannot insert anchors', {
              commentId: comment.id,
              comment,
            });
          }
          continue;
        }

        // Search for the anchor text in the document
        logger.info('Searching for anchor text', {
          commentId: comment.id,
          searchText: comment.anchorText,
          searchLength: comment.anchorText.length,
          docLength: this.editor.state.doc.textContent.length,
          docContainsText: this.editor.state.doc.textContent
            .toLowerCase()
            .includes(comment.anchorText.toLowerCase()),
          docPreview: this.editor.state.doc.textContent.substring(0, 500),
        });

        const searchResult = this.findTextInDocument(comment.anchorText);

        logger.info('Search result', {
          commentId: comment.id,
          found: !!searchResult,
          result: searchResult,
        });

        if (!searchResult) {
          logger.warn('Could not find anchor text in document - marking as orphaned', {
            commentId: comment.id,
            anchorText: comment.anchorText,
            documentText: this.editor.state.doc.textContent.substring(0, 500),
          });

          // Mark the comment as orphaned so it still shows in the sidebar
          commentsStoreV2.updateComment(comment.id, {
            isOrphaned: true,
          });

          // Still update decorations so orphaned comments are visible in sidebar
          this.updateDecorations();
          continue;
        }

        logger.debug('Found anchor text, preparing to insert anchors', {
          commentId: comment.id,
          from: searchResult.from,
          to: searchResult.to,
          docSize: this.editor.state.doc.content.size,
        });

        // Insert anchors at the found position
        if (comment.anchor.type === 'range') {
          // For range comments, insert start and end anchors
          const { from, to } = searchResult;

          // Validate positions
          if (from < 0 || to > this.editor.state.doc.content.size) {
            logger.error('Invalid positions for anchor insertion', {
              commentId: comment.id,
              from,
              to,
              docSize: this.editor.state.doc.content.size,
            });
            continue;
          }

          logger.info('Attempting to insert range anchors', {
            commentId: comment.id,
            from,
            to,
          });

          try {
            // Try to set text selection and insert anchors
            // This might fail if the selection spans across incompatible nodes
            // Mark this as an internal update to prevent external content detection
            const result = this.editor
              .chain()
              .command(({ tr }) => {
                tr.setMeta('anchor-insertion', true);
                tr.setMeta('external-update', true); // Prevent orphan checks
                return true;
              })
              .setTextSelection({ from, to })
              .insertCommentAnchors(comment.id)
              .run();

            logger.info('Anchor insertion command result', {
              commentId: comment.id,
              success: result,
            });

            logger.info('Successfully inserted range anchors for comment', {
              commentId: comment.id,
              from,
              to,
            });
          } catch (selectionError) {
            // If selection fails (e.g., spans across block boundaries),
            // try inserting anchors without selection
            logger.warn('Could not set text selection, trying alternative approach', {
              commentId: comment.id,
              error:
                selectionError instanceof Error ? selectionError.message : String(selectionError),
            });

            // Insert anchors at the positions directly
            try {
              // Insert end anchor first (so positions don't shift)
              this.editor
                .chain()
                .insertContentAt(to, {
                  type: 'commentAnchor',
                  attrs: {
                    id: `${comment.id}:end`,
                    type: 'end',
                    commentId: comment.id,
                  },
                })
                .insertContentAt(from, {
                  type: 'commentAnchor',
                  attrs: {
                    id: `${comment.id}:start`,
                    type: 'start',
                    commentId: comment.id,
                  },
                })
                .run();

              logger.debug('Inserted anchors using direct insertion', {
                commentId: comment.id,
                from,
                to,
              });
            } catch (insertError) {
              logger.error('Failed to insert anchors directly', {
                commentId: comment.id,
                error: insertError instanceof Error ? insertError.message : String(insertError),
              });
            }
          }
        } else {
          // For point comments, insert a single anchor
          const pos = searchResult.from;

          // Validate position
          if (pos < 0 || pos > this.editor.state.doc.content.size) {
            logger.error('Invalid position for anchor insertion', {
              commentId: comment.id,
              pos,
              docSize: this.editor.state.doc.content.size,
            });
            continue;
          }

          try {
            this.editor.chain().setTextSelection(pos).insertCommentAnchors(comment.id).run();

            logger.debug('Inserted point anchor for comment', {
              commentId: comment.id,
              pos,
            });
          } catch (selectionError) {
            // Try direct insertion if selection fails
            logger.warn('Could not set text selection for point, trying direct insertion', {
              commentId: comment.id,
              error:
                selectionError instanceof Error ? selectionError.message : String(selectionError),
            });

            try {
              this.editor
                .chain()
                .insertContentAt(pos, {
                  type: 'commentAnchor',
                  attrs: {
                    id: `${comment.id}:point`,
                    type: 'point',
                    commentId: comment.id,
                  },
                })
                .run();

              logger.debug('Inserted point anchor using direct insertion', {
                commentId: comment.id,
                pos,
              });
            } catch (insertError) {
              logger.error('Failed to insert point anchor directly', {
                commentId: comment.id,
                error: insertError instanceof Error ? insertError.message : String(insertError),
              });
            }
          }
        }
      } catch (error) {
        logger.error('Failed to insert anchors for comment', {
          commentId: comment.id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          anchorText: comment.anchorText,
          anchor: comment.anchor,
        });
      }
    }

    // Clear the flag
    this.isInsertingAnchors = false;

    // Update decorations to show the newly inserted anchors
    logger.debug('Updating decorations after anchor insertion');
    this.updateDecorations();

    // Notify that content has changed (anchors were inserted)
    if (this.onContentChanged) {
      logger.debug('Notifying content changed after anchor insertion');
      this.onContentChanged();
    }
  }

  /**
   * Find text in the document
   */
  private findTextInDocument(searchText: string): { from: number; to: number } | null {
    if (!this.editor || !searchText) {
      logger.debug('findTextInDocument: No editor or search text', {
        hasEditor: !!this.editor,
        searchText,
      });
      return null;
    }

    const doc = this.editor.state.doc;
    const textContent = doc.textContent.toLowerCase();
    const searchLower = searchText.toLowerCase();

    logger.debug('findTextInDocument: Searching', {
      searchText: searchLower.substring(0, 50),
      docLength: textContent.length,
      docPreview: textContent.substring(0, 200),
    });

    // Find the position of the search text
    let index = textContent.indexOf(searchLower);

    // If exact match not found, try partial match (in case text was truncated)
    if (index === -1 && searchLower.length > 20) {
      // Try searching for the first part of the text
      const partialSearch = searchLower.substring(0, Math.min(searchLower.length - 5, 40));
      index = textContent.indexOf(partialSearch);

      if (index !== -1) {
        logger.debug('findTextInDocument: Found partial match', {
          originalSearch: searchLower.substring(0, 50),
          partialSearch,
        });
        // Adjust the search text length to match what was actually found
        // Find where the partial text ends in the full document
        let endIndex = index + partialSearch.length;
        // Try to extend to word boundary
        while (
          endIndex < textContent.length &&
          textContent[endIndex] !== ' ' &&
          textContent[endIndex] !== '\n'
        ) {
          endIndex++;
        }

        return {
          from: index + 1, // +1 because ProseMirror positions are 1-indexed
          to: endIndex + 1,
        };
      }
    }

    if (index === -1) {
      logger.debug('findTextInDocument: Text not found', {
        searchText: searchLower.substring(0, 50),
        docContainsFooter: textContent.includes('footer'),
        docContainsWattenberger: textContent.includes('wattenberger'),
      });
      return null;
    }

    // Convert text index to document position
    // ProseMirror positions are gaps between nodes, not indices into text
    let fromPos = -1;
    let toPos = -1;

    // Use TextBetween to find the exact positions
    try {
      let textOffset = 0;

      doc.descendants((node, pos) => {
        if (fromPos !== -1 && toPos !== -1) return false; // Already found

        if (node.isText) {
          const nodeText = node.text || '';
          const nodeStart = textOffset;
          const nodeEnd = textOffset + nodeText.length;

          // Check if our search starts in this node
          if (fromPos === -1 && nodeStart <= index && index <= nodeEnd) {
            const offset = index - nodeStart;
            fromPos = pos + offset;

            // Check if the search also ends in this node
            const searchEnd = index + searchText.length;
            if (searchEnd <= nodeEnd) {
              toPos = pos + (searchEnd - nodeStart);
            }
          }
          // Check if our search ends in this node (but didn't start here)
          else if (fromPos !== -1 && toPos === -1) {
            const searchEnd = index + searchText.length;
            if (nodeStart < searchEnd && searchEnd <= nodeEnd) {
              const offset = searchEnd - nodeStart;
              toPos = pos + offset;
            }
          }

          textOffset += nodeText.length;
        }

        return true; // Continue traversing
      });
    } catch (e) {
      logger.error('Error finding text position', {
        error: e instanceof Error ? e.message : String(e),
        searchText: searchText.substring(0, 50),
      });
      return null;
    }

    if (fromPos === -1 || toPos === -1) {
      logger.debug('findTextInDocument: Could not convert text position to doc position', {
        index,
        fromPos,
        toPos,
        searchText: searchText.substring(0, 50),
      });
      return null;
    }

    logger.debug('findTextInDocument: Found text at position', {
      searchText: searchText.substring(0, 50),
      from: fromPos,
      to: toPos,
    });

    return {
      from: fromPos,
      to: toPos,
    };
  }

  /**
   * Save comments to backend
   */
  private async saveComment(comment: CommentV2): Promise<boolean> {
    try {
      const markId =
        comment.anchor.type === 'range'
          ? `${comment.anchor.startId}|${comment.anchor.endId}`
          : comment.anchor.pointId;

      logger.info('Saving comment with markId', {
        commentId: comment.id,
        markId,
        anchorType: comment.anchor.type,
      });

      // Map frontend status to backend status
      const backendStatus =
        comment.status === 'accepted' || comment.status === 'rejected'
          ? 'resolved'
          : (comment.status as 'open' | 'resolved' | 'pending');

      const backendComment = await addCommentToBackend(this.workspaceId, this.noteId, {
        id: comment.id, // Pass the frontend-generated ID
        content: comment.content,
        type: comment.type,
        author: comment.author,
        authorType: comment.authorType,
        status: backendStatus,
        section: comment.anchorText,
        threadId: comment.threadId,
        parentId: comment.parentId,
        // Store anchor info in markId for backward compatibility
        markId,
        agentId: comment.type === 'session' ? (comment as any).agentId : undefined,
      });

      if (backendComment) {
        logger.info('Backend comment returned', {
          backendId: backendComment.id,
          backendMarkId: backendComment.markId,
          originalId: comment.id,
        });

        // Update local comment with backend ID if different
        if (backendComment.id !== comment.id) {
          commentsStoreV2.updateComment(comment.id, { id: backendComment.id });
        }
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to save comment', error);
      return false;
    }
  }

  /**
   * Set up editor listeners
   */
  private setupEditorListeners() {
    if (!this.editor) return;

    // Listen for document changes that might affect anchors
    this.editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) {
        // Only check for orphaned comments if we're not in the middle of an external update
        // External updates might temporarily remove anchors but we handle that separately
        const isExternalUpdate = transaction.getMeta('external-update');
        if (!isExternalUpdate) {
          // Check if any anchors were deleted
          this.checkForOrphanedComments();
        }
      }
    });
  }

  /**
   * Check for comments that have lost their anchors (debounced)
   */
  private checkForOrphanedComments() {
    // Clear any existing timeout
    if (this.orphanCheckTimeout) {
      clearTimeout(this.orphanCheckTimeout);
    }

    // Debounce the check to prevent excessive calls
    this.orphanCheckTimeout = setTimeout(() => {
      this.performOrphanCheck();
    }, 1000); // Wait 1 second before checking
  }

  /**
   * Actually perform the orphan check (called after debounce)
   */
  private performOrphanCheck() {
    if (!this.editor) return;

    const anchoredCommentIds = getAllAnchoredCommentIds(this.editor.state.doc);
    // Only check comments for the current note
    const currentNoteComments = commentsStoreV2.comments.filter(
      (comment) => comment.noteId === this.noteId,
    );

    // Only log if we actually find orphaned comments
    const orphanedComments = currentNoteComments.filter(
      (comment) => !anchoredCommentIds.has(comment.id),
    );

    if (orphanedComments.length > 0) {
      logger.warn('Found orphaned comments', {
        count: orphanedComments.length,
        noteId: this.noteId,
        orphanedIds: orphanedComments.map((c) => c.id),
      });
      // Could mark as orphaned or try to recover
    }
  }

  async reapplyAnchorsForCurrentComments(options?: { reason?: string; updateVersion?: number }) {
    if (!this.editor) {
      logger.warn('Cannot reapply anchors - editor not initialized', {
        workspaceId: this.workspaceId,
        noteId: this.noteId,
        reason: options?.reason,
      });
      return;
    }

    const currentNoteComments = commentsStoreV2.comments.filter(
      (comment) => comment.noteId === this.noteId,
    );

    if (currentNoteComments.length === 0) {
      logger.debug('No comments to reapply anchors for', {
        workspaceId: this.workspaceId,
        noteId: this.noteId,
        reason: options?.reason,
      });
      return;
    }

    logger.debug('Reapplying anchors for current comments', {
      workspaceId: this.workspaceId,
      noteId: this.noteId,
      commentCount: currentNoteComments.length,
      reason: options?.reason,
      updateVersion: options?.updateVersion,
    });

    await this.insertAnchorsForLoadedComments(currentNoteComments);
  }

  /**
   * Update visual decorations
   */
  private updateDecorations() {
    if (!this.editor) return;

    // Log all anchors in the document (only in debug mode to reduce log spam)
    const allAnchors = getAllAnchoredCommentIds(this.editor.state.doc);
    logger.debug('Updating decorations', {
      anchorCount: allAnchors.size,
    });

    updateCommentDecorations(this.editor.view);
  }

  /**
   * Add a new comment at the current selection or specified position
   */
  async addComment(
    content: string,
    type: CommentV2['type'] = 'comment',
    agentId?: string,
  ): Promise<CommentV2 | null> {
    if (!this.editor) {
      logger.error('Editor not initialized');
      return null;
    }

    // Ensure editor has a valid selection
    if (!this.editor.state || !this.editor.state.selection) {
      logger.error('Cannot add comment: no valid selection');
      return null;
    }

    const selection = this.editor.state.selection;
    const from = selection.from;
    const to = selection.to;
    // Validate positions
    if (from === undefined || to === undefined || from < 0 || to < 0) {
      logger.error('Cannot add comment: invalid selection positions', { from, to });
      return null;
    }

    // Get selected text and context
    const selectedText = this.editor.state.doc.textBetween(from, to);
    const beforeText = this.editor.state.doc.textBetween(Math.max(0, from - 50), from);
    const afterText = this.editor.state.doc.textBetween(
      to,
      Math.min(this.editor.state.doc.content.size, to + 50),
    );

    // Create base comment fields
    const baseComment = {
      threadId: `thread-${Date.now()}`,
      content,
      type,
      author: 'User',
      authorType: 'user' as const,
      status: 'open' as const,
      anchor:
        from === to
          ? { type: 'point' as const, pointId: '' } // Will be set after anchor insertion
          : { type: 'range' as const, startId: '', endId: '' },
      anchorText: selectedText,
      anchorContext: {
        before: beforeText,
        after: afterText,
      },
    };

    // Create type-specific comment
    let comment: Omit<CommentV2, 'id' | 'createdAt' | 'updatedAt'>;
    if (type === 'session') {
      if (!agentId) {
        throw new Error('agentId is required for session comments');
      }
      // Create session comment with proper type
      comment = { ...baseComment, type: 'session', agentId } as Omit<
        CommentV2,
        'id' | 'createdAt' | 'updatedAt'
      >;
    } else {
      comment = { ...baseComment, type } as Omit<CommentV2, 'id' | 'createdAt' | 'updatedAt'>;
    }

    // Add comment to store
    const addedComment = commentsStoreV2.addComment(comment);

    // Insert anchors in the document
    try {
      if (from === to) {
        // Point comment - set selection first, then insert anchor
        this.editor.chain().focus().setTextSelection(from).insertPointAnchor(addedComment.id).run();

        // Update anchor ID
        commentsStoreV2.updateComment(addedComment.id, {
          anchor: { type: 'point', pointId: `${addedComment.id}:point` },
        });
      } else {
        // Range comment - set selection first, then insert anchors
        this.editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .insertCommentAnchors(addedComment.id)
          .run();

        // Update anchor IDs
        commentsStoreV2.updateComment(addedComment.id, {
          anchor: {
            type: 'range',
            startId: `${addedComment.id}:start`,
            endId: `${addedComment.id}:end`,
          },
        });
      }
    } catch (error) {
      logger.error('Failed to insert comment anchors', error);
      // Remove the comment if anchor insertion failed
      commentsStoreV2.removeComment(addedComment.id);
      return null;
    }

    // Get the updated comment with anchor IDs from the store
    const updatedComment = commentsStoreV2.getComment(addedComment.id);
    if (!updatedComment) {
      logger.error('Comment not found in store after anchor insertion');
      return null;
    }

    // Save to backend with updated anchor IDs
    await this.saveComment(updatedComment);

    // Update decorations
    this.updateDecorations();

    logger.info('Added comment', { commentId: addedComment.id, type });
    return addedComment;
  }

  /**
   * Remove a comment and its anchors
   */
  async removeComment(commentId: string): Promise<boolean> {
    if (!this.editor) {
      logger.error('Editor not initialized');
      return false;
    }

    // Remove anchors from document
    this.editor.chain().focus().removeCommentAnchors(commentId).run();

    // Remove from store
    const removed = commentsStoreV2.removeComment(commentId);

    if (removed) {
      // Update decorations
      this.updateDecorations();
      logger.info('Removed comment', { commentId });
    }

    return removed;
  }

  /**
   * Resolve a comment
   */
  async resolveComment(commentId: string): Promise<boolean> {
    const updated = commentsStoreV2.updateComment(commentId, { status: 'resolved' });

    if (updated) {
      // Save to backend
      await resolveCommentInBackend(this.workspaceId, commentId, this.noteId);

      // Update decorations
      this.updateDecorations();
      logger.info('Resolved comment', { commentId });
    }

    return updated;
  }

  /**
   * Reply to a comment
   */
  async replyToComment(parentId: string, content: string): Promise<CommentV2 | null> {
    const parentComment = commentsStoreV2.getComment(parentId);
    if (!parentComment) {
      logger.error('Parent comment not found', { parentId });
      return null;
    }

    // Create reply with same anchor as parent
    const reply = commentsStoreV2.addComment({
      threadId: parentComment.threadId,
      content,
      type: 'comment',
      author: 'User',
      authorType: 'user',
      status: 'open',
      parentId,
      anchor: parentComment.anchor, // Use same anchor as parent
      anchorText: parentComment.anchorText,
      anchorContext: parentComment.anchorContext,
    });

    // Save to backend
    await this.saveComment(reply);

    logger.info('Added reply', { replyId: reply.id, parentId });
    return reply;
  }

  /**
   * Scan anchor health - detect orphaned comments
   *
   * Compares what comments exist in the store (should have anchors)
   * vs what anchors actually exist in the editor.
   *
   * This is the core of V3 orphan detection.
   */
  async scanAnchorHealth(): Promise<void> {
    if (!this.editor) {
      logger.debug('Cannot scan anchor health - editor not initialized');
      return;
    }

    // Get all comments for this note
    const comments = commentsStoreV2.comments.filter((comment) => comment.noteId === this.noteId);

    logger.debug('Scanning anchor health', {
      commentCount: comments.length,
      noteId: this.noteId,
    });

    // Check each comment
    for (const comment of comments) {
      // If comment has no anchor metadata, mark as orphaned
      if (!comment.anchor) {
        if (!comment.isOrphaned) {
          logger.debug('Comment has no anchor metadata - marking as orphaned', {
            commentId: comment.id,
          });
          commentsStoreV2.updateComment(comment.id, { isOrphaned: true });
        }
        continue;
      }

      // Find anchors in the editor
      const anchors = findCommentAnchors(this.editor.state.doc, comment.id);

      // Check if anchors are complete
      let isOrphaned = false;

      if (comment.anchor.type === 'range') {
        // Range comment needs both start and end anchors
        isOrphaned = anchors.start === undefined || anchors.end === undefined;
      } else if (comment.anchor.type === 'point') {
        // Point comment needs point anchor
        isOrphaned = anchors.point === undefined;
      }

      // Update orphaned status if changed or undefined
      if (comment.isOrphaned !== isOrphaned) {
        logger.debug('Anchor health changed', {
          commentId: comment.id,
          wasOrphaned: comment.isOrphaned,
          nowOrphaned: isOrphaned,
          anchorType: comment.anchor.type,
          foundAnchors: anchors,
        });

        commentsStoreV2.updateComment(comment.id, { isOrphaned });

        // If newly orphaned, remove any remaining broken anchors
        if (isOrphaned) {
          this.removeOrphanedAnchors(comment.id);
        }
      }
    }

    logger.debug('Anchor health scan complete', {
      commentCount: comments.length,
    });
  }

  /**
   * Remove orphaned anchors from the document
   *
   * When a comment becomes orphaned (missing or incomplete anchors),
   * we should clean up any remaining broken anchors to avoid leaving
   * stale markers in the document.
   */
  private removeOrphanedAnchors(commentId: string): void {
    if (!this.editor) {
      return;
    }

    // Check if there are any anchors for this comment
    const anchors = findCommentAnchors(this.editor.state.doc, commentId);
    const hasAnyAnchors =
      anchors.start !== undefined || anchors.end !== undefined || anchors.point !== undefined;

    if (hasAnyAnchors) {
      logger.debug('Removing orphaned anchors', { commentId, anchors });
      this.editor.chain().removeCommentAnchors(commentId).run();
    }
  }

  /**
   * Handle debounced save - runs scanner before save
   */
  async handleDebouncedSave(): Promise<void> {
    // Run scanner to detect orphaned comments
    await this.scanAnchorHealth();

    // Notify that content should be saved
    if (this.onContentChanged) {
      this.onContentChanged();
    }
  }
}
