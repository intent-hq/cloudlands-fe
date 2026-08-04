<script lang="ts">
  /**
   * QuestionsDismissedNotice Component
   *
   * Centered inline chip rendered for daemon-delivered dismissal notification
   * rows (metadata `{ type: "questions_dismissed", source: "system",
   * dismissedQuestionsMessageId }`, `agent.dismissQuestions`). Visually
   * distinct from user/assistant bubbles — the row informs the model that the
   * user dismissed its pending questions without answering.
   */
  import Fa from 'svelte-fa';
  import { faCommentSlash } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Full delivered message text, surfaced as a hover title. */
    title?: string;
  }

  let { title }: Props = $props();
</script>

<div class="questions-dismissed-notice flex items-center gap-3 my-4 w-full" role="status" {title}>
  <div class="h-px flex-1 bg-border"></div>
  <span class="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
    <Fa icon={faCommentSlash} class="w-3 h-3 flex-shrink-0" />
    {m.chat_questionsDismissedNotice_dismissed_label()}
  </span>
  <div class="h-px flex-1 bg-border"></div>
</div>
