<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import UnifiedCommentThread from './UnifiedCommentThread.svelte';

  // Demo data
  const demoComment = {
    id: 'demo-1',
    author: 'Alice Smith',
    content:
      'This is a great implementation! I really like how the animation works smoothly between collapsed and expanded states. The unified component approach makes the transitions much cleaner.',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 minutes ago
    status: 'open',
    type: 'comment',
  };

  const demoReplies = [
    {
      id: 'reply-1',
      author: 'Bob Johnson',
      content: 'I agree! The animation is really smooth now.',
      createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(), // 20 minutes ago
      status: 'open',
      type: 'comment',
    },
    {
      id: 'reply-2',
      author: 'Carol Davis',
      content: 'Great work on this refactor!',
      createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(), // 10 minutes ago
      status: 'open',
      type: 'comment',
    },
  ];

  let isCollapsed = $state(true);
  let replyValue = $state('');

  function handleShow() {
    isCollapsed = false;
  }

  function handleReply(content: string) {
    logger.info('Reply:', content);
    replyValue = '';
  }

  function handleReplyValueChange(value: string) {
    replyValue = value;
  }
</script>

<div class="p-8 bg-background min-h-screen">
  <div class="max-w-4xl mx-auto space-y-8">
    <div>
      <h1 class="text-2xl font-bold mb-4">Unified Comment Thread Demo</h1>
      <p class="text-subtle mb-6">
        Click the comment or the "Show replies" button to expand. The same first message structure
        is used in both states for smooth animation.
      </p>
    </div>

    <div class="space-y-4">
      <div class="flex items-center gap-4 mb-4">
        <button
          class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          onclick={() => (isCollapsed = !isCollapsed)}
        >
          {isCollapsed ? 'Expand' : 'Collapse'} Comment
        </button>
        <span class="text-sm text-subtle">
          Current state: {isCollapsed ? 'Collapsed' : 'Expanded'}
        </span>
      </div>

      <div
        class="relative"
        role="button"
        tabindex="0"
        onclick={() => {
          if (isCollapsed) {
            isCollapsed = false;
          }
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (isCollapsed) {
              isCollapsed = false;
            }
          }
        }}
      >
        <UnifiedCommentThread
          comment={demoComment}
          replies={demoReplies}
          {isCollapsed}
          {replyValue}
          onReplyValueChange={handleReplyValueChange}
          onShow={handleShow}
          onReply={handleReply}
          onResolve={() => logger.info('Resolved')}
          onEdit={() => logger.info('Edit')}
        />
      </div>
    </div>

    <div class="mt-8 p-4 bg-muted rounded-lg">
      <h3 class="font-semibold mb-2">Key Features:</h3>
      <ul class="space-y-1 text-sm text-subtle">
        <li>• Same message structure in both collapsed and expanded states</li>
        <li>• Smooth transitions between states</li>
        <li>• Consistent avatar and header positioning</li>
        <li>• Reply count shown in collapsed state</li>
        <li>• Full thread with replies and input shown in expanded state</li>
        <li>• Click anywhere on collapsed comment to expand</li>
      </ul>
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }
</style>
