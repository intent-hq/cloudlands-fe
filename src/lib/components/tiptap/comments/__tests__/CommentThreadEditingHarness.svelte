<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import UnifiedCommentThread from '../UnifiedCommentThread.svelte';

  // An expanded open comment: its content container carries `.custom-scrollbar`, and
  // the Edit action mounts a TipTapEditor inside that container.
  const comment = {
    id: 'comment-1',
    author: 'Test User',
    content: 'A comment that can be edited in place',
    createdAt: new Date(0).toISOString(),
    status: 'open',
    type: 'comment',
  };
</script>

<TooltipPrimitive.Provider>
  <UnifiedCommentThread {comment} isCollapsed={false} />
</TooltipPrimitive.Provider>
