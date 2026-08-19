<script lang="ts">
  import AttachmentPreview from '../AttachmentPreview.svelte';
  import StreamingStatus from '../StreamingStatus.svelte';
  import ThinkingBlock from '../ThinkingBlock.svelte';
  import TurnFailureNotice from '../TurnFailureNotice.svelte';

  interface Props {
    theme?: 'light' | 'dark';
  }

  let { theme = 'light' }: Props = $props();

  $effect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains('light');
    const hadDark = root.classList.contains('dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('light', hadLight);
      root.classList.toggle('dark', hadDark);
    };
  });
</script>

<section class="bg-background p-6 text-foreground" data-theme={theme}>
  <div class="flex flex-col gap-6">
    <div data-testid="attachment-surface" data-background-kind="destructive-tint">
      <AttachmentPreview
        id="failed-attachment"
        name="failed.txt"
        placementStatus="failed"
        variant="chip"
      />
    </div>

    <div data-testid="streaming-surface" data-background-kind="normal">
      <StreamingStatus error="Stream timeout" />
    </div>

    <div data-testid="turn-failure-surface" data-background-kind="destructive-tint">
      <TurnFailureNotice reason="The agent turn failed" />
    </div>

    <div data-testid="operational-secondary-surface" data-background-kind="normal">
      <ThinkingBlock content="Inspect contrast tokens" />
    </div>
  </div>
</section>
