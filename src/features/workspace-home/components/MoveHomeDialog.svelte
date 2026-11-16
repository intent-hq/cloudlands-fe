<script lang="ts">
  /**
   * Move home (PROTOCOL `methods/nodes.md` → "Moving the home"): pick where
   * the workspace's home goes, an agent's machine or a row of the machine
   * list, and confirm. A move from a detached home first warns that changes
   * after the last backup stay behind.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import { InputMessage } from '$lib/components/ui/input-message';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faCircleExclamation } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { MoveHomeTarget } from '$shared/types/workspace-home';
  import {
    parseMoveHomeTargetKey,
    type MoveHomeOption,
    type WorkspaceHomeView,
  } from '../workspace-home';
  import { homeMoveWarningText } from '../workspace-home-copy';

  let {
    open = false,
    static: staticPosition = false,
    view,
    options,
    currentKey = null,
    currentNodeId = null,
    submitting = false,
    failureText = null,
    initialKey = '',
    onSubmit,
    onCancel,
  }: {
    open?: boolean;
    /** Previews only. */
    static?: boolean;
    view: WorkspaceHomeView;
    options: readonly MoveHomeOption[];
    /** The option that names the current home's machine, if listed. */
    currentKey?: string | null;
    /** The current home's machine: agents running there are marked too. */
    currentNodeId?: string | null;
    submitting?: boolean;
    failureText?: string | null;
    /** Previews only: the option chosen when the dialog opens. */
    initialKey?: string;
    onSubmit: (to: MoveHomeTarget) => void;
    onCancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let selected = $state(initialKey);
  $effect(() => {
    // A new opening starts with nothing chosen.
    if (!open) selected = initialKey;
  });

  const agentOptions = $derived(options.filter((option) => option.kind === 'agent'));
  const machineOptions = $derived(options.filter((option) => option.kind !== 'agent'));
  const target = $derived.by(() => {
    const option = options.find((candidate) => candidate.key === selected);
    return option && !option.disabled ? parseMoveHomeTargetKey(option.key) : null;
  });
  const warning = $derived(homeMoveWarningText(view));
  // A move started meanwhile (here or by another client): a second one is refused.
  const moving = $derived(view.state === 'moving');

  function description(option: MoveHomeOption): string | undefined {
    const parts = [
      option.kind === 'agent'
        ? m.workspaceHome_moveDialog_agentDescription({ agent: option.label })
        : null,
      option.key === currentKey || (currentNodeId !== null && option.nodeId === currentNodeId)
        ? m.workspaceHome_moveDialog_currentHome()
        : null,
      option.disabled
        ? (option.reason ?? null)
        : // A cloud entry has no running machine yet: moving there starts one.
          option.kind === 'cloud'
          ? m.workspaceHome_moveDialog_cloudStartsSandbox()
          : option.platform,
    ].filter((part): part is string => !!part);
    return parts.length ? parts.join(' · ') : undefined;
  }

  function submit() {
    if (target && !moving) onSubmit(target);
  }
</script>

{#snippet group(heading: string, rows: readonly MoveHomeOption[])}
  {#if rows.length}
    <div class="grid gap-2">
      <p class="type-caption font-medium text-muted-foreground">{heading}</p>
      {#each rows as option (option.key)}
        <RadioGroup.Item
          value={option.key}
          title={option.kind === 'agent' ? (option.machineName ?? option.label) : option.label}
          description={description(option)}
          disabled={option.disabled}
          data-move-home-option={option.key}
        />
      {/each}
    </div>
  {/if}
{/snippet}

<FormDialog
  {open}
  static={staticPosition}
  title={m.workspaceHome_moveDialog_title()}
  description={m.workspaceHome_moveDialog_description()}
  submitLabel={m.workspaceHome_moveDialog_submit()}
  canSubmit={target !== null && !submitting && !moving}
  busy={submitting}
  onSubmit={submit}
  {onCancel}
>
  <div class="grid gap-4" data-move-home-dialog>
    {#if warning}
      <p
        class="type-body flex items-start gap-2 rounded-(--radius-medium) bg-warning/10 px-3 py-2 text-foreground"
        data-move-home-warning
      >
        <Fa icon={faCircleExclamation} class="mt-1 size-4 shrink-0 text-warning" />
        <span>{warning}</span>
      </p>
    {/if}
    {#if options.length}
      <RadioGroup.Root
        bind:value={selected}
        aria-label={m.workspaceHome_moveDialog_ariaLabel()}
        class="grid gap-4"
      >
        {@render group(m.workspaceHome_moveDialog_agentsHeading(), agentOptions)}
        {@render group(m.workspaceHome_moveDialog_machinesHeading(), machineOptions)}
      </RadioGroup.Root>
    {:else}
      <p class="type-body text-muted-foreground">{m.workspaceHome_moveDialog_empty()}</p>
    {/if}
    {#if moving}
      <InputMessage tone="helper">{m.workspaceHome_moveError_homeMoving()}</InputMessage>
    {:else if failureText}
      <InputMessage tone="error">{failureText}</InputMessage>
    {/if}
  </div>
</FormDialog>
