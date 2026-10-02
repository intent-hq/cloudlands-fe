<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateToDesktopAgent } from '$features/desktop/desktop-agent-navigation';
  import { notify } from '$lib/components/patterns/notify';
  import * as m from '$shared/paraglide/messages.js';
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    void navigateToDesktopAgent(params.get('workspaceId') ?? '', params.get('agentId') ?? '').catch(
      () => notify.error(m.ui_linkHandler_navigationFailed_title()),
    );
  });
</script>
