<script lang="ts">
  import {
    USER_MESSAGE_SURFACE_CLASS,
    USER_MESSAGE_TEXT_CLASS,
  } from '$lib/components/chat/user-message-surface';
  import PinnedUserPrompt from '$lib/components/chat/PinnedUserPrompt.svelte';

  let {
    message = 'A short user prompt.',
    transcriptWidth = 640,
  }: { message?: string; transcriptWidth?: number } = $props();
  let pinnedActivated = $state(false);
</script>

<main class="min-h-full bg-background p-4 text-foreground" data-testid="message-host">
  <div class="fixed size-px bg-sidebar" data-testid="sidebar-reference" aria-hidden="true"></div>
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
      <div class="type-body select-text text-pretty {USER_MESSAGE_TEXT_CLASS}">
        <span class="whitespace-pre-wrap">{message}</span>
      </div>
    </div>
    <div class="type-body mt-8 text-pretty text-foreground" data-testid="assistant-message">
      Agent response remains on the transcript background.
    </div>
    <div class="mt-8">
      <PinnedUserPrompt text={message} onActivate={() => (pinnedActivated = true)} />
    </div>
    <output hidden data-testid="pinned-activation">{pinnedActivated}</output>
  </section>
</main>
