<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { DiffMapPrimitive } from '$shared/types/notes-primitives';
  import DiffMapRichBlock from '$features/diff-map/components/DiffMapRichBlock.svelte';
  import { parseDiffMapDocument } from '$features/diff-map/model/parse-rich-block';
  import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  let { node, extension }: NodeViewProps = $props();
  const primitive = $derived(node?.attrs?.data as DiffMapPrimitive | undefined);
  const document = $derived(parseDiffMapDocument(primitive?.document));
  const workspaceId = $derived(extension?.options?.workspaceId as string | undefined);
</script>

<NodeViewWrapper>
  {#if document}
    <DiffMapRichBlock
      {document}
      onOpen={(file, event) => {
        if (!workspaceId) return;
        const panel = (event.target as HTMLElement)?.closest('[data-panel-id]');
        appStore.dispatch(
          openWorkspaceFile(workspaceId, file.path, {
            openInAdjacentPanel: event.metaKey || event.ctrlKey,
            sourcePanelId: panel?.getAttribute('data-panel-id') ?? undefined,
          }),
        );
      }}
    />
  {/if}
</NodeViewWrapper>
