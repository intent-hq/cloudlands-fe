<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    sidebar?: boolean;
    collaborator?: boolean;
    micro?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'home-dismiss',
    title: 'Workspace reminder dismissal',
    defaultState: 'home',
    states: {
      home: { props: {} },
      sidebar: { props: { sidebar: true } },
      collaborator: { props: { collaborator: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import HomePage from './HomePage.svelte';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { startHomeDismissPreview } from './home-preview-lifecycle';
  import { setupHomeMicroPreview } from './home-micro-preview-fixture';
  let { sidebar = false, collaborator = false, micro = false }: Props = $props();
  const dispose = startHomeDismissPreview(collaborator);
  const microFixture = untrack(() => (micro ? setupHomeMicroPreview(true) : null));
  const workspace$ = selectWorkspaceById('dismiss-review');
  onDestroy(() => {
    microFixture?.dispose();
    dispose();
  });
</script>

<div class="h-[720px] w-full bg-sidebar text-foreground">
  {#if sidebar}
    <div class="w-[248px] p-2"><WorkspaceCard workspace={$workspace$} onClick={() => {}} /></div>
  {:else}<HomePage preview />{/if}
</div>
