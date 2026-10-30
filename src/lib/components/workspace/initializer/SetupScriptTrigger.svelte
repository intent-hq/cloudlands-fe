<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import Terminal from 'phosphor-svelte/lib/Terminal';
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

<div class="grid min-w-0 gap-2">
  {#if presentation !== 'form'}
    <Label for={id}>{m.workspace_setupScriptEditor_setupScript_label()}</Label>
  {/if}
  <Button
    {id}
    type="button"
    variant={presentation === 'form' ? 'ghost' : 'outline'}
    wrapContent={presentation !== 'form'}
    class="w-full min-w-0 gap-2 font-normal {presentation === 'form'
      ? 'h-auto min-h-10 justify-start px-3 pr-2 py-2 text-left text-sm leading-5'
      : 'justify-between text-left'}"
    aria-label={m.workspace_setupScriptEditor_setupScript_label()}
    aria-haspopup="dialog"
    aria-expanded={expanded}
    onclick={onOpen}
  >
    {#if presentation === 'form'}
      <span class="w-22 shrink-0 truncate text-muted-foreground"
        >{m.workspace_compactInitializer_setup_label()}</span
      >
      <Terminal size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
    {/if}
    <span class="flex min-w-0 flex-1 items-center gap-2">
      {#if loading}<IntentMarkLoader size={14} /><span class="truncate"
          >{m.workspace_compactInitializer_detectingSetupScript_label()}</span
        >
      {:else}<span class="truncate">{value}</span>{/if}
    </span>
    <Fa icon={faChevronRight} class="size-3 shrink-0 text-muted-foreground" />
  </Button>
</div>
