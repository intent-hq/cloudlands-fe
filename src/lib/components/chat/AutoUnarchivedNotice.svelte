<script lang="ts">
  /**
   * AutoUnarchivedNotice Component
   *
   * Centered inline divider rendered for daemon-persisted auto-unarchive
   * transcript rows (metadata `{ type: "auto_unarchived", reason:
   * "agent_activity" }`). Visually distinct from user/assistant bubbles —
   * the row records that the workspace was automatically unarchived because
   * a message was sent to this agent.
   */
  import Fa from 'svelte-fa';
  import { faBoxOpen } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Full persisted message text, surfaced as a hover title. */
    title?: string;
  }

  let { title }: Props = $props();
</script>

<div class="auto-unarchived-notice my-4 flex w-full items-center gap-3" role="status" {title}>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
  <span class="flex min-w-0 shrink items-start gap-2 text-center text-xs text-muted-foreground">
    <Fa icon={faBoxOpen} class="mt-0.5 h-3 w-3 flex-shrink-0" />
    <span class="min-w-0 break-words">{m.chat_autoUnarchivedNotice_unarchived_label()}</span>
  </span>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
</div>
