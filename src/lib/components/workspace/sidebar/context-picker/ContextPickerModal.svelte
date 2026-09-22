<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  /**
   * ContextPickerModal - Modal overlay for picking context items
   *
   * A sleek modal that shows when user clicks a provider in AddContextSection.
   * Handles Linear issues, GitHub issues, Sentry issues, and browser URLs.
   */
  import type { ContextProvider } from '$features/context/types';
  import LinearPicker from './LinearPicker.svelte';
  import SentryPicker from './SentryPicker.svelte';
  import BrowserUrlPicker from './BrowserUrlPicker.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    provider: ContextProvider;
    workspaceId: string;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: {
      type: string;
      title: string;
      url: string;
      identifier: string;
      metadata?: Record<string, unknown>;
    }) => void;
  }

  let { provider, workspaceId, isOpen, onClose, onSelect }: Props = $props();

  const providerTitles: Record<ContextProvider, string> = {
    get linear() {
      return m.workspace_contextPicker_linearIssues_label();
    },
    get github() {
      return m.workspace_contextPicker_githubIssues_label();
    },
    get sentry() {
      return m.workspace_contextPicker_sentryIssues_label();
    },
    get browser() {
      return m.workspace_contextPicker_addUrl_label();
    },
    get internal() {
      return m.workspace_multiSelectSidebar_contextTab_label();
    },
  };
</script>

{#if isOpen}
  <ContentDialog
    open={isOpen}
    title={providerTitles[provider]}
    size="lg"
    closeLabel={m.workspace_contextPicker_closeModal_ariaLabel()}
    {onClose}
  >
    {#if provider === 'linear'}
      <LinearPicker {workspaceId} {onSelect} {onClose} />
    {:else if provider === 'sentry'}
      <SentryPicker {workspaceId} {onSelect} {onClose} />
    {:else if provider === 'browser'}
      <BrowserUrlPicker {workspaceId} {onSelect} {onClose} />
    {:else if provider === 'github'}
      <div class="p-8 text-left text-subtle">
        <p class="text-sm">{m.workspace_contextPicker_githubComingSoon_label()}</p>
        <p class="text-xs mt-2">{m.workspace_contextPicker_useBrowserUrls_label()}</p>
      </div>
    {:else}
      <div class="p-8 text-left text-subtle">
        <p class="text-sm">{m.workspace_contextPicker_selectProvider_label()}</p>
      </div>
    {/if}
  </ContentDialog>
{/if}
