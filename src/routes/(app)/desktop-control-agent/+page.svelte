<script lang="ts">
  import { onMount } from 'svelte';
  import { navigateToDesktopAgent } from '$features/desktop/desktop-agent-navigation';
  import { notify } from '$lib/components/patterns/notify';
  import { Screen } from '$lib/components/patterns/screen';
  import * as m from '$shared/paraglide/messages.js';
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    void navigateToDesktopAgent(params.get('workspaceId') ?? '', params.get('agentId') ?? '').catch(
      () => notify.error(m.ui_linkHandler_navigationFailed_title()),
    );
  });
</script>

<Screen>
  <span class="sr-only" role="status">{m.ui_spinner_loading_ariaLabel()}</span>
</Screen>
