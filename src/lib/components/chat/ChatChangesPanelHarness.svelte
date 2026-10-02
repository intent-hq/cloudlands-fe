<script lang="ts">
  import { onMount, setContext, type ComponentProps } from 'svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import {
    WORKSPACE_ROUTE_CONTEXT,
    type WorkspaceRouteContext,
  } from '$lib/utils/workspace-route-context';
  import ChatChangesPanel from './ChatChangesPanel.svelte';

  let props: ComponentProps<typeof ChatChangesPanel> = $props();
  setContext<WorkspaceRouteContext>(WORKSPACE_ROUTE_CONTEXT, {
    workspaceId: WorkspaceId('preview-chat-changes'),
  });

  let frame: HTMLDivElement;
  let diffsReady = $state(false);
  onMount(() => {
    const measure = () => {
      const viewers = [...frame.querySelectorAll<HTMLElement>('.tracked-change-diff-viewer')];
      diffsReady =
        viewers.length === props.changes.length &&
        viewers.every(
          (viewer) =>
            viewer.querySelector('.pure-diff, .error-state') &&
            viewer.getBoundingClientRect().height > 0,
        );
    };
    const resize = new ResizeObserver(measure);
    const observeViewers = () => {
      resize.disconnect();
      frame
        .querySelectorAll('.tracked-change-diff-viewer')
        .forEach((viewer) => resize.observe(viewer));
      measure();
    };
    const mutations = new MutationObserver(observeViewers);
    mutations.observe(frame, { childList: true, subtree: true });
    observeViewers();
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  });
</script>

<div bind:this={frame} class="h-[28rem] w-full min-w-0" data-preview-diffs-ready={diffsReady}>
  <ChatChangesPanel {...props} />
</div>
