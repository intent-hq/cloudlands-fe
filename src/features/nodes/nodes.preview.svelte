<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { confirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { setupNodesFixture as setup, type NodesPreviewState } from '../../test/nodes-preview';

  type Scene =
    | NodesPreviewState
    | 'add-menu'
    | 'prompt'
    | 'invite-prompt'
    | 'orchestrator-menu'
    | 'orchestrator-removed';
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
      // An orchestrator host's row menu: no "Let <backend> run agents here".
      'orchestrator-menu': {
        props: { scene: 'orchestrator-menu' },
        setup: () => setup('orchestrator-host'),
      },
      // The notice after the backend removed a runner that became an orchestrator.
      'orchestrator-removed': {
        props: { scene: 'orchestrator-removed' },
        setup: () => setup('orchestrator-host'),
      },
      'invite-prompt': {
        props: { scene: 'invite-prompt' },
        setup: () => {
          const restore = setup('paste-field');
          void confirm({
            title: m.nodes_prompt_title({ node: 'Lab node', backend: 'Build box' }),
            description: m.nodes_invite_prompt_description({
              node: 'Lab node',
              backend: 'Build box',
            }),
            confirmLabel: m.nodes_prompt_confirm_label(),
            cancelLabel: m.nodes_paste_cancel_label(),
          });
          return restore;
        },
      },
      'invite-claiming': sceneState('invite-claiming'),
      'invite-claimed': sceneState('invite-claimed'),
      'invite-used': sceneState('invite-used'),
      'invite-expired': sceneState('invite-expired'),
      'invite-revoked': sceneState('invite-revoked'),
      'invite-invalid': sceneState('invite-invalid'),
      'invite-unreachable': sceneState('invite-unreachable'),
      'invite-unreachable-spent': sceneState('invite-unreachable-spent'),
      'invite-certificate': sceneState('invite-certificate'),
      'invite-self': sceneState('invite-self'),
      'invite-update-required': sceneState('invite-update-required'),
      'invite-not-owner': sceneState('invite-not-owner'),
      'invites-unsupported': sceneState('invites-unsupported'),
      'invite-labs-off': sceneState('invite-labs-off'),
      'link-version': sceneState('link-version'),
    },
    captureReadiness: { selector: '[data-nodes-scene][data-ready]' },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import { notify } from '$lib/components/patterns/notify';
  import { Toast, toast } from '$lib/components/ui/toast';
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';

  let { scene = 'machines-and-nodes' }: Props = $props();
  const connectionId$ = selectCurrentConnectionId();
  let ready = $state(false);

  const toasterId = 'nodes-preview';
  const toastId = 'nodes-preview-orchestrator-removed';

  /** Open the orchestrator row's menu once the row and then the menu are rendered. */
  async function openOrchestratorMenu() {
    const seek = <T extends Element>(selector: string) =>
      new Promise<T | null>((resolve) => {
        let tries = 0;
        const look = () => {
          const found = document.querySelector<T>(selector);
          if (found || ++tries > 60) resolve(found);
          else requestAnimationFrame(look);
        };
        look();
      });
    (await seek<HTMLButtonElement>('button[aria-label="Actions for Intent cache"]'))?.click();
    await seek('[role="menu"]');
  }

  onMount(() => {
    void (async () => {
      await tick();
      if (scene === 'orchestrator-menu') await openOrchestratorMenu();
      if (scene === 'orchestrator-removed')
        notify.info(m.remoteMachines_removed_orchestrator_info({ machine: 'Intent cache' }), {
          id: toastId,
          toasterId,
          duration: Number.POSITIVE_INFINITY,
        });
      ready = true;
    })();
    return () => toast.dismiss(toastId);
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
  {#if scene === 'orchestrator-removed'}<Toast {toasterId} />{/if}
</div>
