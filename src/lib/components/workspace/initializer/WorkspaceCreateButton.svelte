<script lang="ts">
  import { Button, type ButtonProps } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import { m } from '$shared/paraglide/messages.js';
  import { fly } from '$lib/motion';

  let {
    creating = false,
    valid = true,
    disabled = false,
    label,
    onclick,
    'data-testid': testId,
  }: {
    creating?: boolean;
    valid?: boolean;
    disabled?: boolean;
    label?: string;
    onclick?: ButtonProps['onclick'];
    'data-testid'?: string;
  } = $props();

  const text = $derived(
    creating
      ? (label ?? m.workspace_compactInitializer_stagePreparing_label())
      : m.workspace_compactInitializer_createWorkspace_label(),
  );
</script>

<Button
  {onclick}
  data-testid={testId}
  variant="primary"
  wrapContent={false}
  class="w-full min-w-0 h-auto min-h-11 justify-start gap-3 py-2 type-body font-medium"
  data-dialog-primary-action
  aria-label={text}
  aria-busy={creating || undefined}
  disabled={!valid || creating || disabled}
>
  <span
    class="relative grid min-w-0 flex-1 grid-cols-1 overflow-hidden text-left"
    aria-hidden="true"
    data-slot="workspace-create-label"
  >
    {#key text}
      <span
        class="col-start-1 row-start-1 min-w-0 truncate"
        in:fly={{ tier: 'moderate', distance: '100%' }}
        out:fly={{ tier: 'moderate', distance: '-100%' }}>{text}</span
      >
    {/key}
  </span>
  {#if creating}
    <IntentMarkLoader size={14} />
  {:else}
    <span
      class="inline-flex shrink-0 items-center gap-0.5 font-normal text-primary-foreground/75"
      class:invisible={!valid}
      aria-hidden={!valid ? 'true' : undefined}
    >
      <ShortcutChip class="flex items-center justify-center px-0.5 text-primary-foreground/60"
        >{navigator.userAgent?.includes('Mac') ? '⌘' : 'Ctrl'}</ShortcutChip
      >
      <ShortcutChip class="flex items-center justify-center px-0.5 text-primary-foreground/60"
        >↵</ShortcutChip
      >
    </span>
  {/if}
</Button>
