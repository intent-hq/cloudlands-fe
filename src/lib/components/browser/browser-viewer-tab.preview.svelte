<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { BrowserTabHost } from './browser-tab-host';

  export interface BrowserViewerTabPreviewProps {
    /** Mirror tab: header over a placeholder mirror surface (no webview in the sandbox). */
    mirror: { url: string; title?: string; host: BrowserTabHost };
    width: number;
    showDetails?: boolean;
    /** Owner agent and whether this computer only mirrors the tab. */
    notices?: { agentId?: string; agentName?: string; mirrored: boolean };
  }

  export const ONLINE_HOST: BrowserTabHost = { name: 'office-linux', connected: true };
  export const OFFLINE_HOST: BrowserTabHost = { name: 'travel-air', connected: false };

  export const preview = definePreview<BrowserViewerTabPreviewProps>({
    id: 'browser-viewer-tab',
    title: 'Browser viewer tab',
    defaultState: 'mirror-open',
    states: {
      'mirror-open': {
        props: {
          width: 640,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
        },
      },
      'mirror-agent': {
        props: {
          width: 640,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: { agentId: 'docs-agent', agentName: 'Docs agent', mirrored: true },
        },
      },
      'mirror-user-tab': {
        props: {
          width: 640,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: { mirrored: true },
        },
      },
      'primary-agent': {
        props: {
          width: 640,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: { agentId: 'docs-agent', agentName: 'Conversation layout', mirrored: false },
        },
      },
      'primary-agent-unnamed': {
        props: {
          width: 640,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: { agentId: 'agent-12345678-1234-1234-1234-123456789abc', mirrored: false },
        },
      },
      'primary-agent-tight': {
        props: {
          width: 240,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: { agentId: 'docs-agent', agentName: 'Docs agent', mirrored: false },
        },
      },
      'mirror-agent-narrow': {
        props: {
          width: 360,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: {
            agentId: 'release-agent',
            agentName: 'Release notes researcher with a long name',
            mirrored: true,
          },
        },
      },
      'primary-agent-long-name': {
        props: {
          width: 640,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: {
            agentId: 'release-agent',
            agentName: 'Release notes researcher with a long name',
            mirrored: false,
          },
        },
      },
      'host-offline': {
        props: {
          width: 640,
          mirror: {
            url: 'https://staging.example.com/dashboard',
            title: 'Staging dashboard',
            host: OFFLINE_HOST,
          },
        },
      },
      'host-offline-details': {
        props: {
          width: 360,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: OFFLINE_HOST },
          notices: { agentId: 'docs-agent', agentName: 'Docs agent', mirrored: true },
          showDetails: true,
        },
      },
      'host-offline-narrow': {
        props: {
          width: 240,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: OFFLINE_HOST },
        },
      },
      'mirror-agent-details': {
        props: {
          width: 640,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: { agentId: 'docs-agent', agentName: 'Docs agent', mirrored: true },
          showDetails: true,
        },
      },
    },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import BrowserViewerTabHeader from './BrowserViewerTabHeader.svelte';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import { PREVIEW_FIXTURE_IDS } from '$lib/component-catalog/preview-fixtures';

  let { mirror, width, notices, showDetails = false }: BrowserViewerTabPreviewProps = $props();

  let lastAction = $state('');
  let root: HTMLElement;
  onMount(() => {
    if (showDetails)
      void tick().then(() =>
        root.querySelector<HTMLButtonElement>('[data-browser-status] button')?.click(),
      );
  });
</script>

<section
  bind:this={root}
  class="grid gap-3"
  data-browser-viewer-tab-preview
  style:width={`${width}px`}
>
  <div
    class="flex h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-background"
  >
    <PanelTabBar
      tabs={[
        {
          id: 'browser-preview',
          type: 'browser',
          title: mirror.title ?? mirror.url,
          browserUrl: mirror.url,
          ownerAgentId: notices?.agentId,
          ownerAgentName: notices?.agentName,
          closable: true,
        },
      ]}
      activeTabId="browser-preview"
      panelId={PREVIEW_FIXTURE_IDS.panel}
      workspaceId={PREVIEW_FIXTURE_IDS.workspace}
      isFocused
      onTabClose={() => (lastAction = 'hide-tab')}
    />
    <BrowserViewerTabHeader
      url={mirror.url}
      title={mirror.title}
      host={mirror.host}
      agentOwned={!!notices?.agentId}
      showHostStatus={notices?.mirrored ?? true}
      onNavigate={(url) => (lastAction = `navigate ${url}`)}
      onGoBack={() => (lastAction = 'back')}
      onGoForward={() => (lastAction = 'forward')}
      onRefresh={() => (lastAction = 'refresh')}
      onClose={({ force }) => (lastAction = force ? 'force-close' : 'close')}
    />
    <div
      class="flex flex-1 items-center justify-center bg-muted/20 text-xs text-muted-foreground"
      data-preview-mirror-surface
    >
      <span class="max-w-md truncate px-4">{mirror.url}</span>
    </div>
  </div>
  {#if lastAction}
    <p class="text-xs text-muted-foreground" data-preview-last-action={lastAction}>{lastAction}</p>
  {/if}
</section>
