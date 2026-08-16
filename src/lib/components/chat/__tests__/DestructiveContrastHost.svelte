<script lang="ts">
  import AttachmentPreview from '../AttachmentPreview.svelte';
  import StreamingStatus from '../StreamingStatus.svelte';
  import TurnFailureNotice from '../TurnFailureNotice.svelte';

  interface Props {
    theme?: 'light' | 'dark';
  }

  let { theme = 'light' }: Props = $props();
</script>

<section class:dark={theme === 'dark'} class="bg-background p-6 text-foreground">
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
  </div>
</section>
