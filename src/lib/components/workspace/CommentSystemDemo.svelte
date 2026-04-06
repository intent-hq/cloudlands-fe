<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { createEditorConfig } from '$lib/utils/editor-config';
  import { CommentManagerV2 } from '$features/comments/comment-manager-v2';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectComments, selectSelectedComment } from '$lib/store/slices/comments/comments-selectors';
  import { selectCommentAction, loadCommentsAction, clearCommentsAction } from '$lib/store/slices/comments/comments-slice';

  const reduxDispatch = getDispatch();
  import { createLogger } from '$lib/utils/client-logger';
  import Fa from 'svelte-fa';
  import {
    faComment,
    faLightbulb,
    faCodePullRequest,
    faCircleQuestion,
    faPaperPlane,
    faCheck,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';

  const logger = createLogger('CommentSystemDemo');

  let editor: Editor | null = $state(null);
  let commentManager: CommentManagerV2 | null = $state(null);
  let editorElement: HTMLElement | undefined = $state(undefined);
  let showCommentDialog = $state(false);
  let newCommentType: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session' =
    $state('comment');
  let newCommentContent = $state('');

  // Demo content with anchors already in place
  const demoContent = `
    <h2>Comment System Demo</h2>
    <p>This is a demonstration of the new anchor-based comment system. <!--anchor:demo-1:start-->Select any text to add a comment.<!--anchor:demo-1:end--></p>
    <p>The system uses invisible anchor nodes that survive markdown round-trips. Comments are stored separately from the document.</p>
    <h3>Features</h3>
    <ul>
      <li>✅ Comments survive markdown conversion</li>
      <li>✅ Multiple comment types (comments, suggestions, questions, change requests)</li>
      <li>✅ Thread support with replies</li>
      <li>✅ Visual decorations without modifying document structure</li>
      <li>✅ Robust anchor system that moves with content</li>
    </ul>
    <p><!--anchor:demo-2:point-->Point comments are also supported for specific locations.</p>
  `;

  // Load demo comments
  const demoComments = [
    {
      id: 'demo-1',
      threadId: 'thread-demo-1',
      content: 'This text is highlighted with a comment!',
      type: 'comment' as const,
      author: 'Demo User',
      authorType: 'user' as const,
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      anchor: {
        type: 'range' as const,
        startId: 'demo-1:start',
        endId: 'demo-1:end',
      },
      anchorText: 'Select any text to add a comment.',
    },
    {
      id: 'demo-2',
      threadId: 'thread-demo-2',
      content: 'This is a point comment at a specific location.',
      type: 'suggestion' as const,
      suggestionDiff: {
        original: 'This is a point comment at a specific location.',
        proposed: 'This is an improved point comment at a specific location.',
      },
      author: 'AI Assistant',
      authorType: 'agent' as const,
      status: 'open' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      anchor: {
        type: 'point' as const,
        pointId: 'demo-2:point',
      },
    },
  ];

  onMount(() => {
    if (!editorElement) return;

    // Initialize editor with new comment system
    editor = new Editor(
      createEditorConfig({
        element: editorElement,
        content: demoContent,
        editable: true,
        enableComments: true,
        useNewCommentSystem: true,
        onUpdate: (content) => {
          logger.debug('Content updated', { length: content.length });
        },
        onCommentClick: (commentId) => {
          logger.info('Comment clicked', { commentId });
          reduxDispatch(selectCommentAction(commentId));
        },
      }),
    );

    // Initialize comment manager
    commentManager = new CommentManagerV2('demo-workspace', 'demo-note');

    // Load demo comments
    reduxDispatch(loadCommentsAction(demoComments));

    // Initialize manager with editor
    commentManager.initialize(editor);

    logger.info('Comment system demo initialized');
  });

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
    if (commentManager) {
      commentManager.destroy();
    }
    reduxDispatch(clearCommentsAction());
  });

  // Reactive state
  const comments$ = selectComments();
  const selectedComment$ = selectSelectedComment();
  let comments = $derived($comments$);
  let selectedComment = $derived($selectedComment$);

  function handleAddComment() {
    if (!editor || !commentManager) return;

    const { from, to } = editor.state.selection;
    if (from === to) {
      alert('Please select some text to comment on');
      return;
    }

    showCommentDialog = true;
  }

  async function submitComment() {
    if (!commentManager || !newCommentContent) return;

    await commentManager.addComment(newCommentContent, newCommentType);

    // Reset dialog
    showCommentDialog = false;
    newCommentContent = '';
    newCommentType = 'comment';
  }

  async function resolveComment(commentId: string) {
    if (!commentManager) return;
    await commentManager.resolveComment(commentId);
  }

  async function deleteComment(commentId: string) {
    if (!commentManager) return;
    await commentManager.removeComment(commentId);
  }

  function getCommentIcon(type: string) {
    switch (type) {
      case 'suggestion':
        return faLightbulb;
      case 'change-request':
        return faCodePullRequest;
      case 'question':
        return faCircleQuestion;
      case 'session':
        return faPaperPlane;
      default:
        return faComment;
    }
  }
</script>

<div class="comment-demo-container">
  <div class="demo-header">
    <h1>New Comment System Demo</h1>
    <p class="text-subtle">Anchor-based comments that survive markdown round-trips</p>
  </div>

  <div class="demo-layout">
    <!-- Editor -->
    <div class="editor-panel">
      <div class="editor-toolbar">
        <button onclick={handleAddComment} class="toolbar-button" disabled={!editor}>
          <Fa icon={faComment} />
          Add Comment
        </button>
      </div>

      <div class="editor-container">
        <div bind:this={editorElement} class="demo-editor"></div>
      </div>
    </div>

    <!-- Comments Panel -->
    <div class="comments-panel">
      <h3>Comments ({comments.length})</h3>

      <div class="comments-list">
        {#each comments as comment (comment.id)}
          <div
            class="comment-card"
            class:selected={selectedComment?.id === comment.id}
            class:resolved={comment.status === 'resolved'}
          >
            <div class="comment-header">
              <div class="comment-meta">
                <Fa icon={getCommentIcon(comment.type)} />
                <span class="comment-author">{comment.author}</span>
                {#if comment.authorType === 'agent'}
                  <span class="agent-badge">AI</span>
                {/if}
              </div>
              <div class="comment-status status-{comment.status}">
                {comment.status}
              </div>
            </div>

            <div class="comment-content">
              {comment.content}
            </div>

            {#if comment.anchorText}
              <div class="comment-context">
                <span class="context-label">On:</span>
                <span class="context-text">"{comment.anchorText}"</span>
              </div>
            {/if}

            <div class="comment-actions">
              {#if comment.status === 'open'}
                <button onclick={() => resolveComment(comment.id)} class="action-button resolve">
                  <Fa icon={faCheck} /> Resolve
                </button>
              {/if}
              <button onclick={() => deleteComment(comment.id)} class="action-button delete">
                <Fa icon={faTrash} /> Delete
              </button>
            </div>
          </div>
        {/each}

        {#if comments.length === 0}
          <div class="no-comments">
            <p>No comments yet</p>
            <p class="text-subtle">Select text and click "Add Comment" to start</p>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Comment Dialog -->
  {#if showCommentDialog}
    <div
      class="comment-dialog-overlay"
      role="button"
      tabindex="0"
      onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && (showCommentDialog = false)}
      onclick={() => (showCommentDialog = false)}
    >
      <div
        class="comment-dialog"
        role="dialog"
        tabindex="-1"
        onkeydown={(e) => e.stopPropagation()}
        onclick={(e) => e.stopPropagation()}
      >
        <h3>Add Comment</h3>

        <div class="comment-type-selector">
          <label>
            <input type="radio" bind:group={newCommentType} value="comment" />
            <Fa icon={faComment} /> Comment
          </label>
          <label>
            <input type="radio" bind:group={newCommentType} value="suggestion" />
            <Fa icon={faLightbulb} /> Suggestion
          </label>
          <label>
            <input type="radio" bind:group={newCommentType} value="change-request" />
            <Fa icon={faCodePullRequest} /> Change Request
          </label>
          <label>
            <input type="radio" bind:group={newCommentType} value="question" />
            <Fa icon={faCircleQuestion} /> Question
          </label>
        </div>

        <textarea bind:value={newCommentContent} placeholder="Enter your comment..." rows="4"
        ></textarea>

        <div class="dialog-actions">
          <button onclick={() => (showCommentDialog = false)} class="cancel-button">
            Cancel
          </button>
          <button onclick={submitComment} class="submit-button" disabled={!newCommentContent}>
            Add Comment
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .comment-demo-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--color-background);
  }

  .demo-header {
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--color-border);
  }

  .demo-layout {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--color-border);
  }

  .editor-toolbar {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-muted);
  }

  .toolbar-button {
    padding: 0.5rem 1rem;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .toolbar-button:hover {
    opacity: 0.9;
  }

  .toolbar-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .editor-container {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
  }

  .demo-editor {
    min-height: 100%;
  }

  /* Rest of styles continue... */
</style>
