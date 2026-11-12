<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'chat-appearance-settings',
    title: 'Chat appearance settings',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import ChatAppearanceSettings from './ChatAppearanceSettings.svelte';
</script>

<div class="w-full min-w-0 bg-background text-foreground" data-testid="chat-appearance-settings">
  <ChatAppearanceSettings />
</div>
