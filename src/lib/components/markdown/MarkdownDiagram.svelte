<script lang="ts">
  import DiagramPresentation from '$lib/components/diagrams/DiagramPresentation.svelte';
  import StreamingDiagramRenderer from '$lib/components/diagrams/StreamingDiagramRenderer.svelte';
  import MermaidRenderer from './MermaidRenderer.svelte';
  import { NotesPrimitivesSerializer } from '$lib/utils/notes-primitives-serializer';
  import { parseIncrementalDiagramJson } from '$lib/utils/incrementalDiagramJson';
  import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store } from '$store/renderer/store';
  import { handleLink } from '$features/navigation/link-handler';
  import { noteUrl } from '$shared/constants/intent-links';
  import { WorkspaceId } from '$shared/types/branded-ids';

  let {
    kind,
    source,
    workspaceId,
  }: { kind: 'mermaid' | 'diagram'; source: string; workspaceId?: string } = $props();

  const serializer = new NotesPrimitivesSerializer();
  const projection = $derived.by(() => {
    if (kind === 'mermaid') return null;
    const parsed = serializer.parseMarkdown(`\`\`\`ws-block:diagram\n${source}\n\`\`\``)[0];
    const normalized =
      parsed?.primitive.type === 'diagram' ? JSON.stringify(parsed.primitive) : source;
    return parseIncrementalDiagramJson(normalized, true);
  });

  function handleBindingClick(event: MouseEvent, binding: { type: string; target: string }) {
    if (!workspaceId || !binding.target) return;
    const options = {
      openInAdjacentPanel: event.metaKey || event.ctrlKey,
      sourcePanelId:
        (event.target as Element)?.closest('[data-panel-id]')?.getAttribute('data-panel-id') ??
        undefined,
    };
    if (binding.type === 'file')
      store.dispatch(openWorkspaceFile(workspaceId, binding.target, options));
    else if (binding.type === 'note')
      void handleLink(noteUrl(binding.target, workspaceId), {
        ...options,
        workspaceId: WorkspaceId(workspaceId),
        event,
      });
  }
</script>

{#if kind === 'mermaid'}
  <DiagramPresentation kind="mermaid" rendererOwnsActions>
    <MermaidRenderer code={source} showExportButton />
  </DiagramPresentation>
{:else}
  <DiagramPresentation kind="custom">
    <StreamingDiagramRenderer
      diagram={projection?.diagram ?? null}
      {source}
      sourceError={projection?.error}
      onBindingClick={handleBindingClick}
    />
  </DiagramPresentation>
{/if}
