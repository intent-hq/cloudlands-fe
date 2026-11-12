<script lang="ts">
  /**
   * Set it up for me over SSH: the run. Plain steps (Connecting → Installing
   * → Starting → Pairing → Adding), the unknown-host-key question, a distinct
   * message per failure with Try again and Run it myself instead, the one
   * extra step some computers need, and the redacted log.
   */
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import {
    faCheck,
    faChevronDown,
    faChevronRight,
    faCircle,
    faTriangleExclamation,
    faXmark,
  } from '$lib/icons/phosphor-icons';
  import {
    Button,
    CopyInput,
    IntentMarkLoader,
  } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import type { SshSetupStep } from '$shared/types/machine-setup';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentBackendLabel } from '$features/remote-machines/remote-machines-selectors';
  import { nodeAddErrorMessage } from '$features/nodes/node-add-errors';
  import { lingerCommand } from './install-lines';
  import { sshHostKeyAnswered, type SshRunState } from './machine-setup-slice';
  import { sshFailureHint, sshFailureMessage } from './ssh-failure-messages';

  interface Props {
    run: SshRunState;
    /** Show the log open (previews). */
    logOpen?: boolean;
    onTryAgain: () => void;
    onRunItMyself: () => void;
  }

  let { run, logOpen = $bindable(false), onTryAgain, onRunItMyself }: Props = $props();

  const backend$ = selectCurrentBackendLabel();
  // An existing install replaces Installing with Found, and starts only if stopped.
  const steps = $derived<SshSetupStep[]>(
    run.existing
      ? [
          'connecting',
          'found',
          ...(run.startedExisting ? (['starting'] as const) : []),
          'pairing',
          'adding',
        ]
      : ['connecting', 'installing', 'starting', 'pairing', 'adding'],
  );
  const stepLabel: Record<SshSetupStep, () => string> = {
    connecting: () => m.machineSetup_run_connecting_label(),
    installing: () => m.machineSetup_run_installing_label(),
    found: () => m.machineSetup_run_found_label({ host: run.host }),
    starting: () => m.machineSetup_run_starting_label(),
    pairing: () => m.machineSetup_run_pairing_label(),
    adding: () => m.machineSetup_run_adding_label(),
  };

  const current = $derived(steps.indexOf(run.step));
  type Status = 'done' | 'active' | 'failed' | 'pending';
  function status(index: number): Status {
    if (run.phase === 'done') return 'done';
    if (index < current) return 'done';
    if (index > current) return 'pending';
    return run.phase === 'failed' ? 'failed' : 'active';
  }

  const failureMessage = $derived.by(() => {
    const failure = run.failure;
    if (!failure) return '';
    if (failure.code === 'link-rejected' && failure.addError)
      return nodeAddErrorMessage(failure.addError, $backend$);
    return sshFailureMessage(failure, run.host);
  });
  const failureHint = $derived(run.failure ? sshFailureHint(run.failure) : null);
  const needsStep = $derived(run.phase === 'done' && run.lingerUser !== null);

  let logBox: HTMLPreElement | null = $state(null);
  $effect(() => {
    void run.log.length;
    if (!logOpen || !logBox) return;
    const box = logBox;
    void tick().then(() => (box.scrollTop = box.scrollHeight));
  });
</script>

<div class="space-y-5" data-machine-setup-ssh-run={run.phase}>
  <div class="space-y-2" role="list" aria-label={m.machineSetup_run_steps_ariaLabel()}>
    {#each steps as step, index (step)}
      {@const state = status(index)}
      <div class="flex items-center gap-3" role="listitem" data-step={step} data-status={state}>
        <span class="flex size-4 items-center justify-center" aria-hidden="true">
          {#if state === 'done'}
            <Fa icon={faCheck} class="size-3.5 text-success" />
          {:else if state === 'active'}
            <IntentMarkLoader size={14} />
          {:else if state === 'failed'}
            <Fa icon={faXmark} class="size-3.5 text-danger" />
          {:else}
            <Fa icon={faCircle} class="size-2 text-subtle" />
          {/if}
        </span>
        <span class={state === 'pending' ? 'type-body text-muted-foreground' : 'type-body'}>
          {stepLabel[step]()}
        </span>
      </div>
    {/each}
    {#if needsStep}
      <div class="flex items-center gap-3" role="listitem" data-step="extra">
        <span class="flex size-4 items-center justify-center" aria-hidden="true">
          <Fa icon={faTriangleExclamation} class="size-3.5 text-warning" />
        </span>
        <span class="type-body">{m.machineSetup_run_needsStep_label()}</span>
      </div>
    {/if}
  </div>

  {#if run.phase === 'hostKey' && run.hostKey}
    <div class="space-y-3 rounded-lg bg-muted/50 p-4" data-machine-setup-host-key>
      <div class="space-y-1">
        <p class="type-body font-medium text-foreground">
          {m.machineSetup_hostKey_title({ host: run.host })}
        </p>
        <p class="type-caption text-muted-foreground">{m.machineSetup_hostKey_description()}</p>
      </div>
      <!-- i18n-ignore (SSH key fingerprint, not translatable copy) -->
      <p class="font-mono text-xs break-all">{run.hostKey.algorithm} {run.hostKey.fingerprint}</p>
      <div class="flex gap-2">
        <Button type="button" onclick={() => appStore.dispatch(sshHostKeyAnswered(true))}
          >{m.machineSetup_hostKey_trust_label()}</Button
        >
        <Button
          type="button"
          variant="ghost-light"
          onclick={() => appStore.dispatch(sshHostKeyAnswered(false))}
          >{m.machineSetup_hostKey_decline_label()}</Button
        >
      </div>
    </div>
  {/if}

  {#if run.phase === 'failed' && run.failure}
    <div class="space-y-2" role="alert" data-machine-setup-error={run.failure.code}>
      <p class="type-body text-danger">{failureMessage}</p>
      {#if failureHint}
        <p class="type-caption text-muted-foreground">{failureHint}</p>
      {/if}
      {#if run.failure.fingerprint}
        <!-- i18n-ignore (SSH key fingerprint) -->
        <p class="font-mono text-xs break-all text-muted-foreground">{run.failure.fingerprint}</p>
      {/if}
      <div class="flex gap-2 pt-1">
        <Button type="button" variant="outline" onclick={onTryAgain}
          >{m.machineSetup_run_tryAgain_label()}</Button
        >
        <Button type="button" variant="ghost-light" onclick={onRunItMyself}
          >{m.machineSetup_run_runItMyself_label()}</Button
        >
      </div>
    </div>
  {/if}

  {#if needsStep && run.lingerUser}
    <div class="space-y-2" data-machine-setup-linger>
      <p class="type-body text-foreground">
        {m.machineSetup_run_linger_description({ host: run.host })}
      </p>
      <CopyInput value={lingerCommand(run.lingerUser)} class="font-mono" />
    </div>
  {/if}
  {#if run.phase === 'done' && run.remoteTurnedOn}
    <p class="type-caption text-muted-foreground" data-machine-setup-remote-on>
      {m.machineSetup_run_remoteOn_description({ host: run.host })}
    </p>
  {/if}

  {#if run.log.length > 0}
    <div class="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="-ml-2"
        aria-expanded={logOpen}
        onclick={() => (logOpen = !logOpen)}
      >
        <Fa icon={logOpen ? faChevronDown : faChevronRight} class="mr-1.5 size-3" />
        {logOpen ? m.machineSetup_run_hideLog_label() : m.machineSetup_run_showLog_label()}
      </Button>
      {#if logOpen}
        <pre
          bind:this={logBox}
          class="max-h-56 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
          data-machine-setup-log>{run.log.join('\n')}</pre>
      {/if}
    </div>
  {/if}
</div>
