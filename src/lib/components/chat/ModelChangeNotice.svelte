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
  import { toStore } from 'svelte/store';
  import { selectModelDisplayName } from '$store/renderer/slices/model/model-selectors';
  import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatModelChangeLabel, type ModelChangeNoticeInfo } from './model-change-notice';

  interface Props {
    workspaceId?: string;
    notice: ModelChangeNoticeInfo;
    /** Fallback text (message content) when the metadata fields are absent. */
    fallbackText?: string;
  }

  let {
    notice,
    workspaceId,
    fallbackText = m.chat_modelChangeNotice_fallback_label(),
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
  const toName$ = selectModelDisplayName(
    toProvider,
    toStore(() => notice.to ?? ''),
    toStore(() => workspaceId),
  );
  const label = $derived.by(() => {
    // Keep mounted transcript rows current when discovery or hydration supplies names.
    void $fromName$;
    void $fromProviderName$;
    void $toProviderName$;
    void $toName$;
    return formatModelChangeLabel(notice, fallbackText, workspaceId);
  });
</script>

<div class="model-change-notice my-4 flex w-full min-w-0 items-center gap-3" role="status">
  <div class="h-px min-w-4 flex-1 bg-border"></div>
  <span class="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
    <Fa icon={faArrowRightArrowLeft} class="mt-0.5 h-3 w-3 flex-shrink-0" />
    <span class="min-w-0 break-words">{label}</span>
  </span>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
</div>
