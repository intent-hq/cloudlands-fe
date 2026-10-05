<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import CaretRight from 'phosphor-svelte/lib/CaretRight';
  import { m } from '$shared/paraglide/messages.js';

  let {
    value,
    loading = false,
    expanded = false,
    onOpen,
  }: {
    value: string;
    loading?: boolean;
    expanded?: boolean;
    onOpen: () => void;
  } = $props();
  const id = $props.id();
</script>

<div class="grid min-w-0 gap-2">
  <Label for={id}>{m.workspace_setupScriptEditor_setupScript_label()}</Label>
  <Button
    {id}
    type="button"
    variant="outline"
    class="w-full min-w-0 justify-between gap-2 text-left font-normal"
    aria-haspopup="dialog"
    aria-expanded={expanded}
    onclick={onOpen}
  >
    <span class="flex min-w-0 items-center gap-2">
      {#if loading}<IntentMarkLoader size={14} /><span class="truncate"
          >{m.workspace_compactInitializer_detectingSetupScript_label()}</span
        >
      {:else}<span class="truncate">{value}</span>{/if}
    </span>
    <CaretRight size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
  </Button>
</div>
