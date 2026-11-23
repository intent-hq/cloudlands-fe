<script lang="ts">
  /**
   * ModelChangeNotice Component
   *
   * Centered inline divider rendered for daemon-persisted model-change
   * transcript rows (metadata `{ type: "model_changed", from, to,
   * fromProvider, toProvider }`). Visually distinct from user/assistant
   * bubbles — the row is informational and was never sent to the provider.
   */
  import ChatInlineDivider from './ChatInlineDivider.svelte';
  import { toStore } from 'svelte/store';
  import { selectModelDisplayName } from '$store/renderer/slices/model/model-selectors';
  import {
    selectProviderCatalogEntries,
    selectProviderCatalogLoaded,
    selectProviderCatalogProfiles,
    selectProviderDisplayName,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectHidesProviderProfileNames } from '$store/renderer/slices/workspace/workspace-selectors';
  import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { providerRefBaseId } from '$shared/provider-profiles';
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
  // Profile names (§5.54) label the notice, so renames and removals relabel it.
  const profiles$ = selectProviderCatalogProfiles(toStore(() => workspaceId));
  // "Removed profile" is said only once the catalog has loaded.
  const catalogLoaded$ = selectProviderCatalogLoaded();
  const catalogEntries$ = selectProviderCatalogEntries(toStore(() => workspaceId));
  // A guest sees bare provider names, never the host's profiles.
  const hidesProfileNames$ = selectHidesProviderProfileNames(toStore(() => workspaceId ?? ''));
  // A profile side falls back to its base provider's model names.
  const fromBaseName$ = selectModelDisplayName(
    toStore(() => providerRefBaseId(notice.fromProvider ?? '')),
    toStore(() => notice.from ?? ''),
    toStore(() => workspaceId),
  );
  const toBaseName$ = selectModelDisplayName(
    toStore(() => providerRefBaseId(notice.toProvider ?? '')),
    toStore(() => notice.to ?? ''),
    toStore(() => workspaceId),
  );
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
    void $profiles$;
    void $hidesProfileNames$;
    void $catalogLoaded$;
    void $catalogEntries$;
    void $fromBaseName$;
    void $toBaseName$;
    return formatModelChangeLabel(notice, fallbackText, workspaceId);
  });
</script>

<ChatInlineDivider icon={faArrowRightArrowLeft} class="model-change-notice">
  <span class="min-w-0 break-words">{label}</span>
</ChatInlineDivider>
