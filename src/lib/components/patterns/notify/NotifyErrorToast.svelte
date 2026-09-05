<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    message: string;
    details: string;
  }

  let { message, details }: Props = $props();

  async function copyDetails() {
    await navigator.clipboard.writeText(details);
  }
</script>

<div class="flex min-w-0 flex-1 flex-col gap-2">
  <p class="break-words text-sm font-medium text-foreground">{message}</p>
  <details class="min-w-0 text-xs text-muted-foreground">
    <summary class="cursor-pointer select-none font-medium text-foreground">
      {m.chat_toolCall_technicalDetails_label()}
    </summary>
    <pre
      class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted p-2">{details}</pre>
    <Button variant="outline" size="sm" class="mt-2" onclick={copyDetails}>
      {m.ui_errorToast_copy_label()}
    </Button>
  </details>
</div>
