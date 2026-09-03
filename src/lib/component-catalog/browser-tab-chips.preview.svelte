<script lang="ts" module>
  import { definePreview } from './preview-definition';

  interface BrowserTabChipsPreviewProps {
    count: number;
    width: number;
  }

  export const preview = definePreview<BrowserTabChipsPreviewProps>({
    id: 'browser-tab-chips',
    title: 'Browser tabs in an agent header',
    defaultState: 'five-tabs',
    states: {
      'one-tab': { props: { count: 1, width: 640 } },
      'three-tabs': { props: { count: 3, width: 640 } },
      'five-tabs': { props: { count: 5, width: 640 } },
      narrow: { props: { count: 5, width: 380 } },
    },
  });
</script>

<script lang="ts">
  import BrowserTabChips from '$lib/components/chat/BrowserTabChips.svelte';
  import type { BrowserTabEntry } from '$lib/components/chat/browser-tab-entries';

  let { count, width }: BrowserTabChipsPreviewProps = $props();
  const workspaceId = 'browser-tab-chips-preview';
  const agentId = 'browser-tab-chips-agent';
  const labels = ['Intent docs', 'Dashboard', 'Pull request', 'Long reference page', 'Preview'];

  function buildEntries(entryCount: number): BrowserTabEntry[] {
    return labels.slice(0, entryCount).map((title, index) => {
      const hidden = entryCount > 1 && index === entryCount - 1;
      return {
        tab: {
          id: `browser-preview-${index}`,
          type: 'browser',
          title,
          browserUrl: `https://preview-${index}.example.test/`,
          ownerAgentId: agentId,
          closable: true,
        },
        ...(hidden ? {} : { panelId: 'browser-preview-panel' }),
        active: index === 0,
        hidden,
      };
    });
  }

  const entries = $derived(buildEntries(count));
</script>

<section
  class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
  style:width={`${width}px`}
  data-browser-tab-chips-preview
  data-preview-count={count}
>
  <div
    class="flex h-10 min-w-0 items-center gap-2 border-b border-border px-2"
    data-panel-content-header
  >
    <span class="h-2.5 w-24 shrink rounded-full bg-muted"></span>
    <span class="min-w-0 flex-1"></span>
    <span class="flex min-w-0 items-center gap-1.5">
      <BrowserTabChips {workspaceId} {agentId} {entries} />
      <span class="size-6 shrink-0 rounded-md bg-muted/60"></span>
    </span>
  </div>
  <div class="h-24 bg-background/70"></div>
</section>
