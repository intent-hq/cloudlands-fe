<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Props = { type: 'addition' | 'deletion' | 'modification' };

  export const preview = definePreview<Props>({
    id: 'suggestion-tooltip',
    title: 'Note suggestion popup',
    defaultState: 'modification',
    states: {
      addition: { props: { type: 'addition' } },
      deletion: { props: { type: 'deletion' } },
      modification: { props: { type: 'modification' } },
    },
    captureReadiness: { selector: '[data-suggestion-preview-ready]' },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { Suggestion, readSuggestionElement, type SuggestionDetails } from './Suggestion';
  import SuggestionTooltip from './SuggestionTooltip.svelte';

  let { type }: Props = $props();

  let host: HTMLDivElement;
  let anchor = $state<HTMLElement | null>(null);
  let suggestion = $state<SuggestionDetails | null>(null);

  const text = { addition: 'within a day', deletion: 'eventually', modification: 'by Friday' };

  onMount(() => {
    const editor = new Editor({
      element: host,
      extensions: [StarterKit, Suggestion],
      content:
        `<p>We will ship the release <span data-suggestion-id="s1" data-suggestion-type="${type}" ` +
        `data-suggestion-author="Release agent" ` +
        (type === 'deletion' ? '' : 'data-suggestion-reason="The QA pass finishes Thursday." ') +
        `data-suggestion-original="next week">${text[type]}</span> after review.</p>`,
    });
    void tick().then(() => {
      const span = host.querySelector<HTMLElement>('.suggestion[data-suggestion-id]');
      if (!span) return;
      anchor = span;
      suggestion = readSuggestionElement(span);
    });
    return () => editor.destroy();
  });
</script>

<section
  class="w-full max-w-xl bg-background p-4 pt-48 text-foreground"
  data-suggestion-preview-ready={suggestion ? '' : undefined}
>
  <div class="tiptap-editor-wrapper">
    <div bind:this={host}></div>
    <SuggestionTooltip {suggestion} {anchor} onClose={() => (suggestion = null)} />
  </div>
</section>
