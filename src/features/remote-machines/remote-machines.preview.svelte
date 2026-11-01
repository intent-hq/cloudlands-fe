<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    setupRemoteMachinesFixture as setup,
    type RemoteMachinesPreviewState,
  } from '../../test/remote-machines-preview';
  const state = (name: RemoteMachinesPreviewState) => ({ props: {}, setup: () => setup(name) });
  export const preview = definePreview({
    id: 'remote-machines',
    title: 'Make a machine available to the backend',
    defaultState: 'expose',
    states: {
      expose: state('expose'),
      exposing: state('exposing'),
      'listener-off': state('listener-off'),
      available: state('available'),
      'in-use': state('in-use'),
      'stops-unconfirmed': state('stops-unconfirmed'),
      'update-required': state('update-required'),
      revoked: state('revoked'),
      unreachable: state('unreachable'),
      unsupported: state('unsupported'),
      'labs-off': state('labs-off'),
    },
    captureReadiness: { selector: '[aria-label="Build box"], article' },
  });
</script>

<script lang="ts">
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  const connectionId$ = selectCurrentConnectionId();
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  {#if $connectionId$ === 'build-box'}
    <DevicesSettings />
  {/if}
</div>
