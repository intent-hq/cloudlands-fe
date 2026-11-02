<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    transcript?: boolean;
    suggestions?: boolean;
    chief?: boolean;
    streaming?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'chat-scroll-fade',
    title: 'Chat scroll fade',
    defaultState: 'conversation',
    states: {
      conversation: { props: { transcript: true, suggestions: true } },
      dark: { props: { transcript: true, suggestions: true, theme: 'dark' } },
      narrow: { props: { transcript: true, suggestions: true, width: 320 } },
      chief: { props: { transcript: true, suggestions: true, chief: true, width: 360 } },
      streaming: { props: { transcript: true, streaming: true } },
      short: { props: { suggestions: true } },
      empty: { props: {} },
    },
  });
</script>

<script lang="ts">
  import ChatPanelComposerGeometryHost from './__tests__/ChatPanelComposerGeometryHost.svelte';

  let {
    theme = 'light',
    width = 720,
    transcript = false,
    suggestions = false,
    chief = false,
    streaming = false,
  }: Props = $props();
</script>

<ChatPanelComposerGeometryHost
  {theme}
  {width}
  {transcript}
  {suggestions}
  {chief}
  {streaming}
  height={640}
  draft="Keep this draft while reading earlier messages."
/>
