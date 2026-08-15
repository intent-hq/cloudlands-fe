<script lang="ts">
  import { USER_MESSAGE_SURFACE_CLASS } from '$lib/components/chat/user-message-surface';

  let {
    message = 'A short user prompt.',
    transcriptWidth = 640,
  }: { message?: string; transcriptWidth?: number } = $props();
</script>

<main class="min-h-full bg-background p-4 text-foreground" data-testid="message-host">
  <section
    class="mx-auto min-w-0 max-w-full"
    style:width={`${transcriptWidth}px`}
    data-testid="transcript"
  >
    <div
      class={USER_MESSAGE_SURFACE_CLASS}
      data-testid="user-message-surface"
      data-conversation-role="user"
    >
      <div class="type-body select-text font-medium! text-pretty text-foreground">
        <span class="whitespace-pre-wrap">{message}</span>
      </div>
    </div>
    <div class="type-body mt-8 text-pretty text-foreground" data-testid="assistant-message">
      Agent response remains on the transcript background.
    </div>
  </section>
</main>
