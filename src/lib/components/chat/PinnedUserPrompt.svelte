<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import { extractAllContent } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    message: AgentMessage;
    compact?: boolean;
    onClick?: () => void;
  }

  let { message, compact = false, onClick }: Props = $props();
  const promptText = $derived(
    extractAllContent(message).trim() || m.chat_shared_context_fallback(),
  );
</script>

<button
  type="button"
  class:compact
  class="pinned-prompt"
  data-testid="pinned-user-prompt"
  aria-label={promptText}
  onclick={onClick}
>
  {promptText}
</button>

<style>
  .pinned-prompt {
    display: block;
    width: 100%;
    overflow: hidden;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--background);
    color: var(--foreground);
    box-shadow: 0 4px 18px rgb(0 0 0 / 12%);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .compact {
    padding-block: 0.45rem;
  }
</style>
