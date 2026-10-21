<script lang="ts">
  /**
   * ProviderFailoverNotice Component
   *
   * Centered inline divider rendered for daemon-persisted quota failover
   * transcript rows (metadata `{ type: "provider_failover", fromProvider,
   * toProvider, model, reason: "quota-exceeded" }`). Visually distinct from
   * user/assistant bubbles — the row is informational, never an error, and
   * was never sent to the provider.
   */
  import Fa from 'svelte-fa';
  import { toStore } from 'svelte/store';
  import {
    selectProviderCatalogEntries,
    selectProviderCatalogLoaded,
    selectProviderCatalogProfiles,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import {
    formatProviderFailoverLabel,
    type ProviderFailoverNoticeInfo,
  } from './provider-failover-notice';

  interface Props {
    workspaceId?: string;
    notice: ProviderFailoverNoticeInfo;
    /** Fallback text (the daemon's message content) when the metadata fields are absent. */
    fallbackText?: string;
  }

  let {
    notice,
    workspaceId,
    fallbackText = m.chat_providerFailoverNotice_fallback_label(),
  }: Props = $props();

  // Profile names label the notice, so renames and removals relabel it;
  // "Removed profile" is said only once the catalog has loaded.
  const profiles$ = selectProviderCatalogProfiles(toStore(() => workspaceId));
  const catalogLoaded$ = selectProviderCatalogLoaded();
  const catalogEntries$ = selectProviderCatalogEntries(toStore(() => workspaceId));
  const label = $derived.by(() => {
    void $profiles$;
    void $catalogLoaded$;
    void $catalogEntries$;
    return formatProviderFailoverLabel(notice, fallbackText, workspaceId);
  });
</script>

<div class="provider-failover-notice my-4 flex w-full min-w-0 items-center gap-3" role="status">
  <div class="h-px min-w-4 flex-1 bg-border"></div>
  <span class="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
    <Fa icon={faArrowRightArrowLeft} class="mt-0.5 h-3 w-3 flex-shrink-0" />
    <span class="min-w-0 break-words">{label}</span>
  </span>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
</div>
