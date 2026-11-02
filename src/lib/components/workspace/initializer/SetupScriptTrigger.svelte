<script lang="ts">
  import { Button, type ButtonProps } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { workspacePickerStyles } from './workspace-picker-styles';
  import { m } from '$shared/paraglide/messages.js';

  let {
    value,
    loading = false,
    expanded = false,
    onOpen,
    presentation = 'default',
    triggerProps,
    ref = $bindable(null),
  }: {
    value: string;
    loading?: boolean;
    expanded?: boolean;
    onOpen: () => void;
    presentation?: 'default' | 'form';
    triggerProps?: ButtonProps;
    ref?: HTMLButtonElement | HTMLAnchorElement | null;
  } = $props();
  const id = $props.id();
</script>

<div class="grid min-w-0 gap-2">
  {#if presentation !== 'form'}
    <Label for={id}>{m.workspace_setupScriptEditor_setupScript_label()}</Label>
  {/if}
  <Button
    {...triggerProps}
    bind:ref
    id={triggerProps?.id ?? id}
    type="button"
    variant={presentation === 'form' ? 'ghost' : 'outline'}
    wrapContent={presentation !== 'form'}
    active={presentation === 'form' && expanded}
    class="w-full min-w-0 gap-2 font-normal {presentation === 'form'
      ? workspacePickerStyles.fieldTrigger
      : 'justify-between text-left'}"
    aria-label={m.workspace_setupScriptEditor_setupScript_label()}
    aria-haspopup="dialog"
    aria-expanded={expanded}
    data-setup-script-trigger
    onclick={triggerProps?.onclick ?? onOpen}
  >
    {#if presentation === 'form'}
      <span class={workspacePickerStyles.fieldLabel}
        >{m.workspace_compactInitializer_setup_label()}</span
      >
    {/if}
    <span class="flex min-w-0 flex-1 items-center gap-2">
      {#if loading}<IntentMarkLoader size={14} /><span class="truncate"
          >{m.workspace_compactInitializer_detectingSetupScript_label()}</span
        >
      {:else}<span class="truncate">{value}</span>{/if}
    </span>
    {#if presentation !== 'form'}
      <Fa icon={faChevronRight} class="size-3 shrink-0 text-muted-foreground" />
    {/if}
  </Button>
</div>
