<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    setupCloudMachinesFixture as setup,
    type CloudMachinesPreviewState,
  } from '../../test/cloud-machines-preview';

  type Scene = CloudMachinesPreviewState | 'start-on' | 'start-on-needs-profile';
  interface Props {
    scene?: Scene;
  }

  const sceneState = (scene: CloudMachinesPreviewState) => ({
    props: { scene },
    setup: () => setup(scene),
  });
  export const preview = definePreview<Props>({
    id: 'cloud-machines',
    title: 'E2B cloud machines in Settings → Machines',
    defaultState: 'connected',
    states: {
      'add-menu': sceneState('add-menu'),
      setup: sceneState('setup'),
      'setup-tested': sceneState('setup-tested'),
      'setup-key-rejected': sceneState('setup-key-rejected'),
      connected: sceneState('connected'),
      'connected-no-sandboxes': sceneState('connected-no-sandboxes'),
      'key-rejected': sceneState('key-rejected'),
      'remove-in-use': sceneState('remove-in-use'),
      unsupported: sceneState('unsupported'),
      'labs-off': sceneState('labs-off'),
      'start-on': { props: { scene: 'start-on' }, setup: () => setup('connected') },
      'start-on-needs-profile': {
        props: { scene: 'start-on-needs-profile' },
        setup: () => setup('connected'),
      },
    },
    captureReadiness: { selector: '[data-cloud-machines-scene][data-ready]' },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  import StartOnPicker from '$lib/components/workspace/initializer/StartOnPicker.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { startOnOptions } from '$features/remote-machines/start-on';
  import { E2B_SANDBOXES } from '../../test/cloud-machines-preview';

  let { scene = 'connected' }: Props = $props();
  const connectionId$ = selectCurrentConnectionId();
  let ready = $state(false);
  let startOnValue = $state('');
  let startOnOpen = $state(true);
  const startOn = $derived(
    startOnOptions({
      backendLabel: 'Build box',
      backendPlatform: { os: 'linux', arch: 'x86_64' },
      machines: [
        {
          ...E2B_SANDBOXES[0]!,
          id: 'd-studio-mac',
          name: 'Studio Mac',
          platform: { os: 'macos', arch: 'aarch64' },
          cloud: undefined,
        },
      ],
      cloud: {
        unavailableReason:
          scene === 'start-on-needs-profile' ? m.cloudMachines_startOn_needsProfile() : null,
      },
    }),
  );

  onMount(async () => {
    await tick();

    ready = true;
  });
</script>

<div
  class="min-h-140 w-full min-w-0 bg-background p-6 text-foreground"
  data-cloud-machines-scene={scene}
  data-ready={ready ? '' : undefined}
>
  {#if scene.startsWith('start-on')}
    <div class="ml-auto w-[320px] pt-2">
      <StartOnPicker
        value={startOnValue}
        options={startOn}
        bind:open={startOnOpen}
        onChange={(id) => (startOnValue = id)}
      />
    </div>
  {:else if $connectionId$ === 'build-box'}
    <DevicesSettings
      initialCloudSetup={scene.startsWith('setup')}
      initialAddMenuOpen={scene === 'add-menu'}
    />
  {/if}
</div>
