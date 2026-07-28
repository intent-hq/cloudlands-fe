<script lang="ts">
  /**
   * ModelChangeNotice Component
   *
   * Centered inline divider rendered for daemon-persisted model-change
   * transcript rows (metadata `{ type: "model_changed", from, to,
   * fromProvider, toProvider }`). Visually distinct from user/assistant
   * bubbles — the row is informational and was never sent to the provider.
   */
  import Fa from 'svelte-fa';
  import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import {
    formatModelChangeLabel,
    type ModelChangeNoticeInfo,
  } from './model-change-notice';

  interface Props {
    notice: ModelChangeNoticeInfo;
    /** Fallback text (message content) when the metadata fields are absent. */
    fallbackText?: string;
  }

  let { notice, fallbackText = m.chat_modelChangeNotice_fallback_label() }: Props = $props();

  const label = $derived(formatModelChangeLabel(notice, fallbackText));
</script>

<div class="model-change-notice flex items-center gap-3 my-4 w-full" role="status">
  <div class="h-px flex-1 bg-border"></div>
  <span class="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
    <Fa icon={faArrowRightArrowLeft} class="w-3 h-3 flex-shrink-0" />
    {label}
  </span>
  <div class="h-px flex-1 bg-border"></div>
</div>
