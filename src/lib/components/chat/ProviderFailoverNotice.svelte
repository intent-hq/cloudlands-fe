<script lang="ts">
  /**
   * ProviderFailoverNotice Component
   *
   * Centered inline divider rendered for daemon-persisted automatic provider
   * switch rows: quota failover (`{ type: "provider_failover", fromProvider,
   * toProvider, model, reason: "quota-exceeded" }`) and the return home
   * (`{ type: "provider_returned", ..., reason: "quota-reset" }`), and the
   * Remote Ready profile picked on a machine without sign-in
   * (`{ type: "provider_auto_selected", ..., machine }`). Visually distinct from
   * user/assistant bubbles — the row is informational, never an error, and
   * was never sent to the provider.
   */
  import ChatInlineDivider from './ChatInlineDivider.svelte';
  import { toStore } from 'svelte/store';
  import {
    selectProviderCatalogEntries,
    selectProviderCatalogLoaded,
    selectProviderCatalogProfiles,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectHidesProviderProfileNames } from '$store/renderer/slices/workspace/workspace-selectors';
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

  let { notice, workspaceId, fallbackText }: Props = $props();

  // Profile names label the notice, so renames and removals relabel it;
  // "Removed profile" is said only once the catalog has loaded.
  const profiles$ = selectProviderCatalogProfiles(toStore(() => workspaceId));
  const catalogLoaded$ = selectProviderCatalogLoaded();
  const catalogEntries$ = selectProviderCatalogEntries(toStore(() => workspaceId));
  // A guest sees bare provider names, never the host's profiles.
  const hidesProfileNames$ = selectHidesProviderProfileNames(toStore(() => workspaceId ?? ''));
  const label = $derived.by(() => {
    void $profiles$;
    void $hidesProfileNames$;
    void $catalogLoaded$;
    void $catalogEntries$;
    return formatProviderFailoverLabel(
      notice,
      fallbackText ??
        (notice.kind === 'returned'
          ? m.chat_providerFailoverNotice_returnedFallback_label()
          : notice.kind === 'autoSelected'
            ? m.chat_providerFailoverNotice_autoSelectedFallback_label()
            : m.chat_providerFailoverNotice_fallback_label()),
      workspaceId,
    );
  });
</script>

<ChatInlineDivider icon={faArrowRightArrowLeft} class="provider-failover-notice">
  <span class="min-w-0 break-words">{label}</span>
</ChatInlineDivider>
