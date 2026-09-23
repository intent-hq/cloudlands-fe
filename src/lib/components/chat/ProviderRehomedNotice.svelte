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
  import Fa from 'svelte-fa';
  import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatProviderRehomedLabel, type ProviderRehomedNoticeInfo } from './rehome-notice';

  interface Props {
    notice: ProviderRehomedNoticeInfo;
    /** Fallback text (the daemon's message content) when the metadata fields are absent. */
    fallbackText?: string;
  }

  let { notice, fallbackText = m.chat_providerRehomedNotice_fallback_label() }: Props = $props();

  const label = $derived(formatProviderRehomedLabel(notice, fallbackText));
</script>

<div class="provider-rehomed-notice my-4 flex w-full min-w-0 items-center gap-3" role="status">
  <div class="h-px min-w-4 flex-1 bg-border"></div>
  <span class="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
    <Fa icon={faArrowRightArrowLeft} class="mt-0.5 h-3 w-3 flex-shrink-0" />
    <span class="min-w-0 break-words">{label}</span>
  </span>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
</div>
