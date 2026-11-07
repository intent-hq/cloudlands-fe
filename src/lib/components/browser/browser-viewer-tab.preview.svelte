<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { BrowserTabHost } from './browser-tab-host';

  export interface BrowserViewerTabPreviewProps {
    /** Mirror tab: header over a placeholder mirror surface (no webview in the sandbox). */
    mirror: { url: string; title?: string; host: BrowserTabHost };
    width: number;
    /** Notices above the address bar: owner agent, and whether this computer only mirrors the tab. */
    notices?: { agentName?: string; mirrored: boolean };
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
          notices: { agentName: 'Docs agent', mirrored: true },
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
          notices: { agentName: 'Docs agent', mirrored: false },
        },
      },
      'mirror-agent-narrow': {
        props: {
          width: 360,
          mirror: { url: 'https://intentapp.dev/docs', title: 'Intent docs', host: ONLINE_HOST },
          notices: { agentName: 'Release notes researcher with a long name', mirrored: true },
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
    },
  });
</script>

<script lang="ts">
  import BrowserTabNotices from './BrowserTabNotices.svelte';
  import BrowserViewerTabHeader from './BrowserViewerTabHeader.svelte';

  let { mirror, width, notices }: BrowserViewerTabPreviewProps = $props();

  let lastAction = $state('');
</script>

<section class="grid gap-3" data-browser-viewer-tab-preview style:width={`${width}px`}>
  <div
    class="flex h-[320px] flex-col overflow-hidden rounded-lg border border-border bg-background"
  >
    {#if notices}
      <BrowserTabNotices
        mirrorHostName={notices.mirrored && mirror.host.connected ? mirror.host.name : undefined}
        agentName={notices.agentName}
        onOpenAgent={() => (lastAction = 'open-agent')}
      />
    {/if}
    <BrowserViewerTabHeader
      url={mirror.url}
      title={mirror.title}
      host={mirror.host}
      onNavigate={(url) => (lastAction = `navigate ${url}`)}
      onGoBack={() => (lastAction = 'back')}
      onGoForward={() => (lastAction = 'forward')}
      onRefresh={() => (lastAction = 'refresh')}
      onClose={() => (lastAction = 'force-close')}
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
