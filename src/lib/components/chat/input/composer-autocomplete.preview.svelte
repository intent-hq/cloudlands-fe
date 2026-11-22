<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    value?: string;
    ghost?: string | null;
  }

  export const preview = definePreview<Props>({
    id: 'composer-autocomplete',
    title: 'Composer autocomplete ghost text',
    defaultState: 'suggestion',
    states: {
      suggestion: {
        props: {
          value: 'Show me the',
          ghost: ' before/after screenshots of the onboarding grid.',
        },
      },
      'partly-typed': {
        props: {
          value: 'Show me the before',
          ghost: '/after screenshots of the onboarding grid.',
        },
      },
      'multi-line': {
        props: {
          value: 'Thanks, that looks right.\nCan you also',
          ghost: ' add the Free badge to the settings provider list?',
        },
      },
      none: { props: { value: 'Show me the', ghost: null } },
    },
    captureReadiness: { selector: '.ProseMirror-focused' },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import TipTapEditor from './TipTapEditor.svelte';

  let { value = '', ghost = null }: Props = $props();
  let editor: TipTapEditor;

  onMount(() => {
    editor.focusEnd();
    void tick().then(() => editor.showAutocompleteSuggestion(ghost));
  });
</script>

<!-- i18n-ignore (isolated preview with synthetic draft text) -->
<div class="flex min-h-40 w-full items-end p-4">
  <div class="rich-input-container w-full rounded-(--radius-medium) bg-card p-3">
    <TipTapEditor bind:this={editor} {value} ariaLabel="Prompt" />
  </div>
</div>
