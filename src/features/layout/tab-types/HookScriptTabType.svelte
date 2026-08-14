<script lang="ts">
  import HookScriptContent from '$lib/components/chat/HookScriptContent.svelte';
  import type { TabTypeComponentProps } from './registry';

  let { tab, workspaceId }: TabTypeComponentProps = $props();
</script>

<div class="h-full min-h-0 min-w-0 max-w-full overflow-hidden p-4" data-testid="hook-script-panel">
  <HookScriptContent workspaceId={tab.workspaceId ?? workspaceId} hookId={tab.hookId ?? ''} />
</div>
