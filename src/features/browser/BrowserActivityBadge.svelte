<script lang="ts">
  import { toStore } from 'svelte/store';
  import BrowserIcon from 'phosphor-svelte/lib/BrowserIcon';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { focusBrowserTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    selectAllTabs,
    selectHiddenTabs,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  let { workspaceId, tabId, url }: { workspaceId: string; tabId: string; url: string } = $props();
  const workspace = toStore(() => workspaceId);
  const tabs = selectAllTabs(workspace);
  const hiddenTabs = selectHiddenTabs(workspace);
  const available = $derived(
    [...$tabs, ...$hiddenTabs].some((tab) => tab.id === tabId && tab.type === 'browser'),
  );
  const host = $derived.by(() => {
    try {
      return new URL(url).host || url;
    } catch {
      return url;
    }
  });
</script>

<Button
  variant="secondary"
  size="sm"
  class="max-w-full rounded-full font-normal"
  disabled={!available}
  title={available ? url : m.browser_activity_unavailable_tooltip()}
  aria-label={m.browser_activity_browsing_label({ host })}
  onclick={() => appStore.dispatch(focusBrowserTabRequested(workspaceId, tabId))}
>
  {#snippet leadingIcon()}<BrowserIcon size={14} aria-hidden="true" />{/snippet}
  {m.browser_activity_browsing_label({ host })}
</Button>
