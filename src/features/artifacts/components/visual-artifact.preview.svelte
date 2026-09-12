<script lang="ts" module>
  import previewHtml from './visual-artifact.preview.html?raw';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { ArtifactDocument } from '$shared/types/visual-artifact';
  export const preview = definePreview<{ kind: ArtifactDocument['kind'] }>({
    id: 'visual-artifact',
    title: 'Visual artifact',
    defaultState: 'board',
    states: {
      board: { props: { kind: 'board' } },
      image: { props: { kind: 'image' } },
      options: { props: { kind: 'options' } },
      preview: { props: { kind: 'preview' } },
    },
  });
  const artwork =
    'data:image/png;base64,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';
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import type { ArtifactSelection } from '$shared/types/visual-artifact';
  import ArtifactEditor from './ArtifactEditor.svelte';
  let { kind }: { kind: ArtifactDocument['kind'] } = $props();
  let document = $state<ArtifactDocument>({
    version: 1,
    id: 'visual-demo',
    title: 'Launch direction',
    kind: 'board',
    items: [
      {
        id: 'a',
        type: 'card',
        text: 'A calmer first impression\n\nMake the next step feel obvious.',
        x: 40,
        y: 45,
        width: 230,
        height: 160,
      },
      {
        id: 'b',
        type: 'card',
        text: 'Room to explore\n\nGive the idea space before choosing a direction.',
        x: 365,
        y: 155,
        width: 245,
        height: 165,
      },
      {
        id: 'c',
        type: 'text',
        text: 'What should we try next?',
        x: 330,
        y: 35,
        width: 290,
        height: 85,
      },
    ],
    connections: [{ id: 'edge', from: 'a', to: 'b' }],
    annotations: [],
    image: { src: artwork, alt: 'Lavender landing page concept' },
    html: previewHtml,
  });
  let selection = $state<ArtifactSelection>({ itemIds: [] });
  $effect(() => {
    const nextKind = kind;
    untrack(() => {
      document.kind = nextKind;
      selection = { itemIds: [] };
    });
  });
</script>

<ArtifactEditor
  {document}
  {selection}
  onChange={(value) => (document = value)}
  onSelect={(value) => (selection = value)}
/>
