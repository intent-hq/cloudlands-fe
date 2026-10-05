<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  let { rules, onClose }: { rules: string | null; onClose: () => void } = $props();
</script>

<ContentDialog
  open
  title={m.chat_rulesInspector_title()}
  closeLabel={m.chat_rulesInspector_close_ariaLabel()}
  size="wide"
  {onClose}
>
  {#if rules}
    <pre
      class="whitespace-pre-wrap break-words font-mono type-caption bg-muted/50 p-4 rounded-md">{rules}</pre>
  {:else}<p class="text-muted-foreground">{m.chat_rulesInspector_noRules_label()}</p>{/if}
</ContentDialog>
