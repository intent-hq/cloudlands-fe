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
    presentation = 'default',
  }: {
    value: string;
    loading?: boolean;
    expanded?: boolean;
    onOpen: () => void;
    presentation?: 'default' | 'form';
  } = $props();
  const id = $props.id();
</script>

<div
  class={presentation === 'form'
    ? 'grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-4'
    : 'grid min-w-0 gap-2'}
>
  <Label
    for={id}
    class={presentation === 'form' ? 'text-sm font-normal text-muted-foreground' : undefined}
    >{presentation === 'form'
      ? m.workspace_compactInitializer_setup_label()
      : m.workspace_setupScriptEditor_setupScript_label()}</Label
  >
  <Button
    {id}
    type="button"
    variant={presentation === 'form' ? 'ghost' : 'outline'}
    class="w-full min-w-0 gap-2 font-normal {presentation === 'form'
      ? 'h-auto min-h-10 justify-between px-2.5 py-2 text-left'
      : 'justify-between text-left'}"
    aria-label={m.workspace_setupScriptEditor_setupScript_label()}
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
