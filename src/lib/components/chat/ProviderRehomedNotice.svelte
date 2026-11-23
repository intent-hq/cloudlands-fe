<script lang="ts">
  /**
   * ProviderRehomedNotice Component
   *
   * Centered inline divider rendered for daemon-persisted provider re-home
   * transcript rows (metadata `{ type: "provider_rehomed", reason:
   * "provider_disabled", from, to, fromProvider, toProvider }`). Visually
   * distinct from user/assistant bubbles — the row is informational and was
   * never sent to the provider.
   */
  import ChatInlineDivider from './ChatInlineDivider.svelte';
  import { toStore } from 'svelte/store';
  import { selectModelDisplayName } from '$store/renderer/slices/model/model-selectors';
  import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatProviderRehomedLabel, type ProviderRehomedNoticeInfo } from './rehome-notice';

  interface Props {
    workspaceId?: string;
    notice: ProviderRehomedNoticeInfo;
    /** Fallback text (the daemon's message content) when the metadata fields are absent. */
    fallbackText?: string;
  }

  let {
    notice,
    workspaceId,
    fallbackText = m.chat_providerRehomedNotice_fallback_label(),
  }: Props = $props();

  const fromProvider = toStore(() => notice.fromProvider ?? '');
  const toProvider = toStore(() => notice.toProvider ?? '');
  const fromName$ = selectModelDisplayName(
    fromProvider,
    toStore(() => notice.from ?? ''),
    toStore(() => workspaceId),
  );
  const fromProviderName$ = selectProviderDisplayName(fromProvider);
  const toProviderName$ = selectProviderDisplayName(toProvider);
  const label = $derived.by(() => {
    // Keep mounted transcript rows current when discovery or hydration supplies names.
    void $fromName$;
    void $fromProviderName$;
    void $toProviderName$;
    return formatProviderRehomedLabel(notice, fallbackText, workspaceId);
  });
</script>

<ChatInlineDivider icon={faArrowRightArrowLeft} class="provider-rehomed-notice">
  <span class="min-w-0 break-words">{label}</span>
</ChatInlineDivider>
