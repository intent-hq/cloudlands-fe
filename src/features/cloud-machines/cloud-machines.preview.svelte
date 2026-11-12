<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    setupCloudMachinesFixture as setup,
    type CloudMachinesPreviewState,
  } from '../../test/cloud-machines-preview';

  type Scene =
    | CloudMachinesPreviewState
    | 'start-on'
    | 'start-on-needs-profile'
    | 'start-on-entries'
    | 'start-on-providers';
  interface Props {
    scene?: Scene;
  }

  const sceneState = (scene: CloudMachinesPreviewState) => ({
    props: { scene },
    setup: () => setup(scene),
  });
  export const preview = definePreview<Props>({
    id: 'cloud-machines',
    title: 'Cloud machines (E2B, Northflank) in Settings (Machines, or Nodes with named entries)',
    defaultState: 'connected',
    states: {
      'add-menu': sceneState('add-menu'),
      setup: sceneState('setup'),
      'setup-tested': sceneState('setup-tested'),
      'setup-key-rejected': sceneState('setup-key-rejected'),
      connected: sceneState('connected'),
      'connected-no-sandboxes': sceneState('connected-no-sandboxes'),
      'sandboxes-grouped': sceneState('sandboxes-grouped'),
      'sandboxes-collapsed': sceneState('sandboxes-collapsed'),
      'key-rejected': sceneState('key-rejected'),
      'remove-in-use': sceneState('remove-in-use'),
      unsupported: sceneState('unsupported'),
      'labs-off': sceneState('labs-off'),
      entries: sceneState('entries'),
      'entries-add': sceneState('entries-add'),
      'entries-key-rejected': sceneState('entries-key-rejected'),
      'entries-rename-taken': sceneState('entries-rename-taken'),
      'entries-single': sceneState('entries-single'),
      'entries-edit': sceneState('entries-edit'),
      'add-cloud-menu': sceneState('add-cloud-menu'),
      'northflank-setup': sceneState('northflank-setup'),
      'northflank-setup-filled': sceneState('northflank-setup-filled'),
      'northflank-setup-error': sceneState('northflank-setup-error'),
      providers: sceneState('providers'),
      'start-on-providers': {
        props: { scene: 'start-on-providers' },
        setup: () => setup('providers'),
      },
      'start-on-entries': {
        props: { scene: 'start-on-entries' },
        setup: () => setup('entries'),
      },
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
  import { E2B_SANDBOXES, NORTHFLANK_ENTRY, TEAM_ENTRY } from '../../test/cloud-machines-preview';

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
      cloud:
        scene === 'start-on-providers'
          ? [
              {
                cloudMachineId: 'e2b',
                label: m.cloudMachines_startOn_entry_label({ name: 'E2B' }),
                unavailableReason: null,
                needsProfile: true,
              },
              {
                cloudMachineId: NORTHFLANK_ENTRY.id,
                label: m.cloudMachines_startOn_northflank_label({ name: NORTHFLANK_ENTRY.name }),
                unavailableReason: null,
                needsProfile: true,
              },
            ]
          : scene === 'start-on-entries'
            ? [
                {
                  cloudMachineId: 'e2b',
                  label: m.cloudMachines_startOn_entry_label({ name: 'E2B' }),
                  unavailableReason: null,
                },
                {
                  cloudMachineId: TEAM_ENTRY.id,
                  label: m.cloudMachines_startOn_entry_label({ name: TEAM_ENTRY.name }),
                  unavailableReason: null,
                  needsProfile: true,
                },
                {
                  cloudMachineId: 'e2b-0c1d2e3f4a5b',
                  label: m.cloudMachines_startOn_entry_label({ name: 'Old project' }),
                  unavailableReason: m.cloudMachines_state_keyRejected_label(),
                },
              ]
            : [
                {
                  cloudMachineId: 'e2b',
                  label: m.cloudMachines_startOn_label(),
                  unavailableReason:
                    scene === 'start-on-needs-profile'
                      ? m.cloudMachines_startOn_needsProfile()
                      : null,
                },
              ],
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
      initialCloudSetup={scene.startsWith('setup') ||
        scene === 'entries-add' ||
        scene.startsWith('northflank-setup')}
      initialCloudProvider={scene.startsWith('northflank-setup') ? 'northflank' : 'e2b'}
      initialCloudDraft={scene === 'northflank-setup-filled' || scene === 'northflank-setup-error'
        ? {
            name: 'Agents EU',
            apiKey: 'preview-token-not-real',
            projectId: 'intent-agents',
          }
        : undefined}
      initialCloudEdit={scene === 'entries-edit' ? 'e2b' : undefined}
      initialAddMenuOpen={scene === 'add-menu' || scene === 'add-cloud-menu'}
      initialAddCloudOpen={scene === 'add-cloud-menu'}
    />
  {/if}
</div>
