<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    setupMachineSetupFixture as setup,
    type MachineSetupPreviewState,
  } from '../../test/machine-setup-preview';

  interface Props {
    scene?: MachineSetupPreviewState;
    logOpen?: boolean;
  }

  const scene = (state: MachineSetupPreviewState, logOpen = false) => ({
    props: { scene: state, logOpen },
    setup: () => setup(state),
  });

  export const preview = definePreview<Props>({
    id: 'machine-setup',
    title: 'Set up a new machine',
    defaultState: 'pick',
    states: {
      pick: scene('pick'),
      'pick-with-node': scene('pick-with-node'),
      paste: scene('paste'),
      'paste-testing': scene('paste-testing'),
      'paste-error': scene('paste-error'),
      details: scene('details'),
      method: scene('method'),
      'manual-backend': scene('manual-backend'),
      'manual-node': scene('manual-node'),
      'ssh-login': scene('ssh-login'),
      'ssh-login-no-agent': scene('ssh-login-no-agent'),
      'ssh-login-password': scene('ssh-login-password'),
      'ssh-connecting': scene('ssh-connecting'),
      'ssh-installing': scene('ssh-installing', true),
      'ssh-host-key': scene('ssh-host-key'),
      'ssh-unreachable': scene('ssh-unreachable'),
      'ssh-auth-refused': scene('ssh-auth-refused'),
      'ssh-host-key-mismatch': scene('ssh-host-key-mismatch'),
      'ssh-unsupported-os': scene('ssh-unsupported-os'),
      'ssh-install-failed': scene('ssh-install-failed', true),
      'ssh-no-link': scene('ssh-no-link'),
      'ssh-link-rejected': scene('ssh-link-rejected'),
      'ssh-done-linger': scene('ssh-done-linger'),
      'ssh-existing-pairing': scene('ssh-existing-pairing'),
      'ssh-existing-started': scene('ssh-existing-started'),
      'ssh-existing-done': scene('ssh-existing-done'),
      'ssh-no-start': scene('ssh-no-start'),
      'ssh-did-not-start': scene('ssh-did-not-start'),
      'ssh-too-old': scene('ssh-too-old'),
      'ssh-orchestrator': scene('ssh-orchestrator'),
    },
    captureReadiness: { selector: '[data-machine-setup-scene][data-ready]' },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import MachineSetupWizard from './MachineSetupWizard.svelte';

  let { scene = 'pick', logOpen = false }: Props = $props();
  let ready = $state(false);

  onMount(async () => {
    await tick();
    ready = true;
  });
</script>

<div
  class="min-h-160 w-full min-w-0 bg-background p-6 text-foreground"
  data-machine-setup-scene={scene}
  data-ready={ready ? '' : undefined}
>
  <MachineSetupWizard static {logOpen} />
</div>
