<script lang="ts">
  /**
   * Set up a new machine: one dialog for every way to add a machine, opened
   * from Settings → Machines → Add machine and the machine rail. Mounted once
   * in the app layout; its screen lives in the `machineSetup` slice.
   *
   * Cards: Paste an intent:// link, Enter connection details (the shared
   * `ConnectBackendForm`), Install a backend, and Install a node (only when
   * the current backend can use nodes). Installing runs the command yourself,
   * or — with Labs SSH machine setup, desktop app only — over SSH.
   */
  import {
    faDesktop,
    faDownload,
    faLink,
    faServer,
    faTerminal,
    faWrench,
  } from '$lib/icons/phosphor-icons';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { FormActions } from '$lib/components/patterns/form';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import ConnectBackendForm from '$lib/components/layout/ConnectBackendForm.svelte';
  import ConnectBackendFooter from '$lib/components/layout/ConnectBackendFooter.svelte';
  import type {
    ConnectBackendForm as ConnectBackendFormApi,
    ConnectBackendStep,
  } from '$lib/components/layout/connect-backend';
  import { selectRemoteMachinesVisible } from '$features/remote-machines/remote-machines-selectors';
  import { selectRemoteConnections } from '$store/renderer/slices/connections/connections-selectors';
  import { SELECTABLE_CONNECTION_ACCENTS } from '$shared/types/connections';
  import PairLinkField from '$features/nodes/PairLinkField.svelte';
  import { selectNodePaste } from '$features/nodes/nodes-selectors';
  import { pasteLinkSubmitted } from '$features/nodes/nodes-slice';
  import { stashPastedLink } from '$features/nodes/pasted-link';
  import { selectMachineSetup, selectSshMachineSetupAvailable } from './machine-setup-selectors';
  import {
    machineSetupClosed,
    machineSetupInstallPicked,
    machineSetupScreenShown,
    sshSetupRequested,
  } from './machine-setup-slice';
  import SetupCards from './SetupCards.svelte';
  import SetupManual from './SetupManual.svelte';
  import SetupSshLogin from './SetupSshLogin.svelte';
  import SetupSshRun from './SetupSshRun.svelte';

  interface Props {
    /** Render in place instead of as a modal overlay (component previews). */
    static?: boolean;
    /** Show the SSH log open (previews). */
    logOpen?: boolean;
  }

  let { static: staticPosition = false, logOpen = false }: Props = $props();

  const setup$ = selectMachineSetup();
  const nodeOffered$ = selectRemoteMachinesVisible();
  const paste$ = selectNodePaste();
  const remoteConnections$ = selectRemoteConnections();
  // Each new machine gets the next accent, as Settings → Machines always did.
  const defaultAccent = $derived(
    SELECTABLE_CONNECTION_ACCENTS[
      $remoteConnections$.length % SELECTABLE_CONNECTION_ACCENTS.length
    ],
  );
  const sshAvailable$ = selectSshMachineSetupAvailable();

  const setup = $derived($setup$);
  const screen = $derived(setup.screen);
  const target = $derived(setup.target);
  const run = $derived(setup.ssh);

  let linkText = $state('');
  let connectForm = $state<ConnectBackendFormApi>();
  let connectStep = $state<ConnectBackendStep>('details');
  let connectBusy = $state(false);
  let connectCanContinue = $state(false);
  let loginForm = $state<{ submit(): void }>();
  let loginCanSubmit = $state(false);

  $effect(() => {
    if (screen !== 'paste' && screen !== 'manual') linkText = '';
  });

  type PickId = 'paste' | 'details' | 'backend' | 'node';
  const pickCards = $derived([
    {
      id: 'paste' as PickId,
      icon: faLink,
      title: m.machineSetup_pick_paste_label(),
      description: m.machineSetup_pick_paste_description(),
    },
    {
      id: 'details' as PickId,
      icon: faDesktop,
      title: m.machineSetup_pick_details_label(),
      description: m.machineSetup_pick_details_description(),
    },
    {
      id: 'backend' as PickId,
      icon: faDownload,
      title: m.machineSetup_pick_backend_label(),
      description: m.machineSetup_pick_backend_description(),
    },
    ...($nodeOffered$
      ? [
          {
            id: 'node' as PickId,
            icon: faServer,
            title: m.machineSetup_pick_node_label(),
            description: m.machineSetup_pick_node_description(),
          },
        ]
      : []),
  ]);

  type MethodId = 'ssh' | 'manual';
  const methodCards = $derived([
    {
      id: 'ssh' as MethodId,
      icon: faTerminal,
      title: m.machineSetup_method_ssh_label(),
      description: m.machineSetup_method_ssh_description(),
      tag: m.machineSetup_method_recommended_label(),
    },
    {
      id: 'manual' as MethodId,
      icon: faWrench,
      title: m.machineSetup_method_manual_label(),
      description: m.machineSetup_method_manual_description(),
    },
  ]);

  const installTitle = $derived(
    target === 'node' ? m.machineSetup_pick_node_label() : m.machineSetup_pick_backend_label(),
  );
  const title = $derived.by(() => {
    switch (screen) {
      case 'paste':
        return m.machineSetup_pick_paste_label();
      case 'details':
        return m.machineSetup_pick_details_label();
      case 'pick':
        return m.machineSetup_title();
      default:
        return installTitle;
    }
  });
  const description = $derived.by(() => {
    switch (screen) {
      case 'pick':
        return m.machineSetup_pick_description();
      case 'paste':
        return m.machineSetup_paste_description();
      case 'method':
        return m.machineSetup_method_description();
      case 'manual':
        return m.machineSetup_manual_description();
      case 'sshLogin':
        return m.machineSetup_ssh_description();
      case 'sshRun':
        return run?.phase === 'done'
          ? m.machineSetup_run_done_description({ host: run.host })
          : m.machineSetup_run_description({ host: run?.host ?? '' });
      default:
        return undefined;
    }
  });

  const testing = $derived($paste$.surface === 'wizard' && $paste$.phase === 'testing');
  const running = $derived(run?.phase === 'running' || run?.phase === 'hostKey');

  function show(next: Parameters<typeof machineSetupScreenShown>[0]) {
    appStore.dispatch(machineSetupScreenShown(next));
  }

  function close() {
    appStore.dispatch(machineSetupClosed());
  }

  function pick(id: PickId) {
    if (id === 'backend' || id === 'node') appStore.dispatch(machineSetupInstallPicked(id));
    else show(id);
  }

  function pickMethod(id: MethodId) {
    show(id === 'ssh' ? 'sshLogin' : 'manual');
  }

  function submitLink() {
    if (!linkText.trim() || testing) return;
    stashPastedLink(linkText);
    // The Install screens' link: choosing to install was the consent.
    appStore.dispatch(pasteLinkSubmitted(screen === 'manual'));
  }

  function tryAgain() {
    const login = setup.lastLogin;
    if (login?.method === 'agent') appStore.dispatch(sshSetupRequested(login));
    else show('sshLogin');
  }

  /** Enter and the primary button. */
  function submit() {
    if (screen === 'paste' || screen === 'manual') submitLink();
    else if (screen === 'sshLogin') loginForm?.submit();
    else if (screen === 'details') {
      if (connectStep === 'details') connectForm?.capture();
      else if (connectStep === 'confirm') connectForm?.confirm();
    } else if (screen === 'sshRun' && run?.phase === 'done') close();
  }

  /** Back from an install screen: to the method choice when there was one. */
  function backFromInstall() {
    show($sshAvailable$ ? 'method' : 'pick');
  }
</script>

{#snippet back(onclick: () => void, disabled = false)}
  <Button type="button" variant="ghost-light" {disabled} {onclick}
    >{m.machineSetup_back_label()}</Button
  >
{/snippet}

<FormDialog
  open={setup.open}
  static={staticPosition}
  size="wide"
  {title}
  {description}
  dismissOnInteractOutside={false}
  enterKey={screen === 'sshRun' && running ? 'ignore' : 'submit'}
  onSubmit={submit}
  onCancel={close}
>
  <div data-machine-setup-screen={screen}>
    {#if screen === 'pick'}
      <SetupCards cards={pickCards} label={m.machineSetup_pick_ariaLabel()} onPick={pick} />
    {:else if screen === 'paste'}
      <div class="space-y-3">
        <PairLinkField bind:text={linkText} />
      </div>
    {:else if screen === 'details'}
      <ConnectBackendForm
        bind:this={connectForm}
        bind:step={connectStep}
        bind:busy={connectBusy}
        bind:canContinue={connectCanContinue}
        active={setup.open && screen === 'details'}
        {defaultAccent}
        showHelp={false}
        onDone={close}
      />
    {:else if screen === 'method'}
      <SetupCards
        cards={methodCards}
        label={m.machineSetup_method_ariaLabel()}
        onPick={pickMethod}
      />
    {:else if screen === 'manual'}
      <SetupManual {target} bind:text={linkText} />
    {:else if screen === 'sshLogin'}
      <SetupSshLogin
        bind:this={loginForm}
        bind:canSubmit={loginCanSubmit}
        prefill={setup.lastLogin}
        agentAvailable={setup.agentAvailable}
      />
    {:else if screen === 'sshRun' && run}
      <SetupSshRun {run} {logOpen} onTryAgain={tryAgain} onRunItMyself={() => show('manual')} />
    {/if}
  </div>

  {#snippet footer()}
    {#if screen === 'details'}
      <FormActions>
        {#snippet primary()}
          <ConnectBackendFooter
            step={connectStep}
            busy={connectBusy}
            canContinue={connectCanContinue}
            form={connectForm}
            detailsSecondaryLabel={m.machineSetup_back_label()}
            onDetailsSecondary={() => show('pick')}
          />
        {/snippet}
      </FormActions>
    {:else}
      <FormActions>
        {#snippet secondary()}
          {#if screen === 'pick'}
            <Button type="button" variant="ghost-light" onclick={close}
              >{m.machineSetup_cancel_label()}</Button
            >
          {:else if screen === 'paste' || screen === 'method'}
            {@render back(() => show('pick'), testing)}
          {:else if screen === 'manual' || screen === 'sshLogin'}
            {@render back(backFromInstall, testing)}
          {:else if screen === 'sshRun' && run?.phase === 'failed'}
            {@render back(() => show('sshLogin'))}
          {:else if screen === 'sshRun' && running}
            <Button type="button" variant="ghost-light" onclick={close}
              >{m.machineSetup_cancel_label()}</Button
            >
          {/if}
        {/snippet}
        {#snippet primary()}
          {#if screen === 'paste' || screen === 'manual'}
            <Button type="submit" loading={testing} disabled={!linkText.trim() || testing}
              >{m.nodes_paste_add_label()}</Button
            >
          {:else if screen === 'sshLogin'}
            <Button type="submit" disabled={!loginCanSubmit}
              >{m.machineSetup_ssh_start_label()}</Button
            >
          {:else if screen === 'sshRun' && run?.phase === 'done'}
            <Button type="submit">{m.machineSetup_done_label()}</Button>
          {/if}
        {/snippet}
      </FormActions>
    {/if}
  {/snippet}
</FormDialog>
