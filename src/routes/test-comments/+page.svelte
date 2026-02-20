<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { createEditorConfig } from '$lib/utils/editor-config';
  import { CommentManagerV2 } from '$features/comments/comment-manager-v2';
  import { commentsStoreV2 } from '$features/comments/comments-v2.store.svelte';
  import CommentsSidebar from '$lib/components/tiptap/CommentsSidebar.svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('TestComments');

  let editorElement: HTMLDivElement;
  let editor: Editor | null = $state(null);
  let commentManager: CommentManagerV2 | null = $state(null);

  const testContent = `# Test Document

This is a test document for the comment system.

## Section 1

This is some text that we can comment on. Let's add a comment to this specific sentence.

## Section 2

More content here for testing purposes.`;

  const testComment = {
    id: 'test-comment-1',
    threadId: 'thread-1',
    content: 'This is a test comment',
    type: 'comment' as const,
    author: 'Test User',
    authorType: 'user' as const,
    status: 'open' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    anchor: {
      type: 'range' as const,
      startId: 'test-comment-1:start',
      endId: 'test-comment-1:end',
    },
    anchorText: 'This is some text that we can comment on.',
  };

  onMount(() => {
    logger.info('Initializing test page');

    // Initialize editor
    editor = new Editor(
      createEditorConfig({
        element: editorElement,
        content: testContent,
        editable: true,
        enableComments: true,
        onUpdate: (content) => {
          logger.debug('Content updated', { length: content.length });
        },
        onCommentClick: (commentId) => {
          logger.info('Comment clicked', { commentId });
          commentsStoreV2.selectComment(commentId);
        },
        useMarkdown: true,
      }),
    );

    // Initialize comment manager
    commentManager = new CommentManagerV2('test-workspace', 'test-note');

    // Load test comment AFTER initializing manager
    commentsStoreV2.loadComments([testComment]);

    // Initialize manager with editor (but skip backend load)
    // We'll manually set the editor instead of calling initialize
    (commentManager as any).editor = editor;
    (commentManager as any).isInitialized = true;

    // Manually insert anchors for the test comment
    setTimeout(() => {
      if (commentManager) {
        (commentManager as any).insertAnchorsForLoadedComments([testComment]);
      }
    }, 100);

    logger.info('Test page initialized', {
      editorReady: !!editor,
      commentManagerReady: !!commentManager,
      commentsLoaded: commentsStoreV2.comments.length,
    });
  });

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
    if (commentManager) {
      commentManager.destroy();
    }
    commentsStoreV2.clear();
  });

  // Reactive state - access store directly, don't use $derived
  // The store's getters are already reactive

  function handleAddComment() {
    if (!editor || !commentManager) return;

    const { from, to } = editor.state.selection;
    if (from === to) {
      alert('Please select some text to comment on');
      return;
    }

    const selectedText = editor.state.doc.textBetween(from, to);
    const newComment = {
      id: `test-comment-${Date.now()}`,
      noteId: 'test-note',
      author: 'Test User',
      authorType: 'user' as const,
      type: 'comment' as const,
      content: 'New test comment',
      section: selectedText,
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      threadId: `thread-${Date.now()}`,
      markId: '',
    };

    commentManager.addComment('New test comment', 'comment');
  }

  $effect(() => {
    logger.info('Component state', {
      storeComments: commentsStoreV2.comments.length,
      selectedComment: commentsStoreV2.selectedComment?.id,
    });
  });
</script>

<div class="flex h-screen bg-background">
  <!-- Editor -->
  <div class="flex-1 flex flex-col p-4">
    <div class="mb-4 flex gap-2">
      <button
        onclick={handleAddComment}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
      >
        Add Comment
      </button>
      <div class="text-sm text-muted-foreground">
        Comments: {commentsStoreV2.comments.length} | Selected: {commentsStoreV2.selectedComment
          ?.id || 'none'}
      </div>
    </div>

    <div bind:this={editorElement} class="flex-1 border rounded-lg p-4 overflow-auto bg-card"></div>
  </div>

  <!-- Sidebar -->
  <div class="w-96 border-l bg-card">
    {#if editor}
      <div class="p-4 border-b">
        <h2 class="text-lg font-semibold">
          Comments ({commentsStoreV2.comments.length})
        </h2>
        <div class="text-xs text-muted-foreground">
          Editor: {!!editor} | Comments: {JSON.stringify(commentsStoreV2.comments.map((c) => c.id))}
        </div>
      </div>
      <div class="p-4 border-2 border-red-500">
        <div class="text-xs mb-2">Before CommentsSidebar</div>
        <CommentsSidebar
          {editor}
          comments={commentsStoreV2.comments}
          onResolve={(id) => commentManager?.resolveComment(id)}
          onReply={(id, content) => commentManager?.replyToComment(id, content)}
        />
        <div class="text-xs mt-2">After CommentsSidebar</div>
      </div>
    {:else}
      <div class="p-4 text-muted-foreground">Loading editor...</div>
    {/if}
  </div>
</div>

<style>
  :global(.comment-highlight) {
    background-color: rgba(255, 235, 59, 0.2);
    border-bottom: 2px solid rgba(255, 235, 59, 0.5);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  :global(.comment-highlight:hover) {
    background-color: rgba(255, 235, 59, 0.3);
    border-bottom-color: rgba(255, 235, 59, 0.8);
  }
</style>
