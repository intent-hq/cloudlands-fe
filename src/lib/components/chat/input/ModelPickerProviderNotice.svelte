<script module lang="ts">
  import { selectProviderCatalogEntryOrDefault } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { store as appStore } from '$store/renderer/store';

  export type ProviderWarningNotice = {
    providerId: string;
    providerName: string;
    message: string;
    docsUrl?: string;
  };

  export function createProviderWarningNotice(
    providerId: string,
    warning: string | undefined,
  ): ProviderWarningNotice | null {
    if (!warning) return null;
    const provider = selectProviderCatalogEntryOrDefault.select(appStore.state, providerId);
    return {
      providerId: provider?.id ?? providerId,
      providerName: provider?.displayName ?? providerId,
      message: warning,
      docsUrl: provider?.loginDocsUrl,
    };
  }
</script>

<script lang="ts">
  import { shell } from '$lib/electron-bridge';
  import {
  faCircleNotch,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    warning?: string;
    docsUrl?: string;
    show: boolean;
    title?: string;
    description?: string;
    linkText?: string;
    variant?: 'warning' | 'progress';
  }

  let {
    warning,
    docsUrl,
    show,
    title = m.chat_modelPicker_defaultModelList_title(),
    description = m.chat_modelPicker_installCodex_description(),
    linkText = m.chat_modelPicker_setupDocs_label(),
    variant = 'warning',
  }: Props = $props();

  const shouldRender = $derived(show && (Boolean(warning) || variant === 'progress'));

  async function openCodexDocs(event: MouseEvent) {
    event.preventDefault();
    if (docsUrl) {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- shell.open is opening an external URL, not fetching domain data; rule misfires on the 'open' method name
      await shell.open(docsUrl);
    }
  }
</script>

{#if shouldRender}
  <div
    class="max-w-[360px] rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
    role="status"
  >
    <div class="flex items-start gap-2">
      {#if variant === 'progress'}
        <Fa icon={faCircleNotch} class="h-3.5 w-3.5 text-warning-foreground mt-0.5 shrink-0 animate-spin" />
      {:else}
        <Fa
          icon={faTriangleExclamation}
          class="h-3.5 w-3.5 text-warning-foreground mt-0.5 shrink-0"
        />
      {/if}
      <div class="min-w-0 leading-snug">
        <div class="font-medium">{title}</div>
        <div class="text-subtle">
          {description}
          {#if docsUrl}
            <a
              href={docsUrl}
              onclick={openCodexDocs}
              class="underline underline-offset-2 hover:text-foreground"
            >
              {linkText}
            </a>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}