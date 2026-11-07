<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { confirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { setupNodesFixture as setup, type NodesPreviewState } from '../../test/nodes-preview';

  type Scene = NodesPreviewState | 'add-menu' | 'prompt';
  interface Props {
    scene?: Scene;
  }

  const sceneState = (scene: NodesPreviewState) => ({
    props: { scene },
    setup: () => setup(scene),
  });
  export const preview = definePreview<Props>({
    id: 'nodes',
    title: 'Machines and Nodes in Settings → Machines',
    defaultState: 'machines-and-nodes',
    states: {
      'no-nodes': sceneState('no-nodes'),
      'machines-and-nodes': sceneState('machines-and-nodes'),
      'add-menu': { props: { scene: 'add-menu' }, setup: () => setup('no-nodes') },
      'paste-field': sceneState('paste-field'),
      testing: sceneState('testing'),
      'added-machine': sceneState('added-machine'),
      prompt: {
        props: { scene: 'prompt' },
        setup: () => {
          const restore = setup('node-not-now');
          void confirm({
            title: m.nodes_prompt_title({ node: 'GPU rig', backend: 'Build box' }),
            description: m.nodes_prompt_description({ node: 'GPU rig', backend: 'Build box' }),
            confirmLabel: m.nodes_prompt_confirm_label(),
            cancelLabel: m.nodes_prompt_cancel_label(),
          });
          return restore;
        },
      },
      'node-not-now': sceneState('node-not-now'),
      'making-available': sceneState('making-available'),
      'node-added': sceneState('node-added'),
      'not-a-link': sceneState('not-a-link'),
      unreachable: sceneState('unreachable'),
      'wrong-token': sceneState('wrong-token'),
      'backend-unsupported': sceneState('backend-unsupported'),
      'labs-off': sceneState('labs-off'),
    },
    captureReadiness: { selector: '[data-nodes-scene][data-ready]' },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';

  let { scene = 'machines-and-nodes' }: Props = $props();
  const connectionId$ = selectCurrentConnectionId();
  let ready = $state(false);

  onMount(async () => {
    await tick();
    ready = true;
  });
</script>

<div
  class="min-h-140 w-full min-w-0 bg-background p-6 text-foreground"
  data-nodes-scene={scene}
  data-ready={ready ? '' : undefined}
>
  {#if $connectionId$ === 'build-box'}
    <DevicesSettings initialAddMenuOpen={scene === 'add-menu'} />
  {/if}
  <ConfirmHost />
</div>
