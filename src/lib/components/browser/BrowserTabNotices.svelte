<script lang="ts">
  /**
   * Notices above an agent-owned browser tab's address bar: the controlling
   * agent (opens its conversation) and, on a mirror whose live webview runs on
   * another client, a warning that cookies and page state stay on the host, so
   * the page can differ from what the agent sees and its URL follows the host.
   */
  import {
    faChevronRight,
    faRobot,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Host display name when this tab mirrors a connected host; unset otherwise. */
    mirrorHostName?: string;
    /** Owner agent display name; unset when no agent owns the tab. */
    agentName?: string;
    onOpenAgent?: (event: MouseEvent) => void;
  }

  let { mirrorHostName, agentName, onOpenAgent }: Props = $props();
</script>

{#if mirrorHostName !== undefined && agentName !== undefined}
  <div
    class="flex shrink-0 items-start gap-2 border-b border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning-ink"
    data-browser-tab-not-primary
    role="status"
  >
    <Fa icon={faTriangleExclamation} class="mt-0.5 shrink-0" />
    <span class="min-w-0 flex-1">
      {m.browser_tabNotice_notPrimary_description({ host: mirrorHostName })}
    </span>
  </div>
{/if}

{#if agentName !== undefined}
  <div class="shrink-0 border-b border-border bg-muted/30" data-browser-tab-agent-control>
    <Button
      variant="plain"
      type="button"
      class="group flex h-auto w-full justify-start rounded-none items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-ring active:bg-active"
      onclick={(event) => onOpenAgent?.(event)}
      title={m.browser_embedded_ownerChip_tooltip({ name: agentName })}
    >
      <Fa icon={faRobot} class="shrink-0" size="sm" />
      <span class="min-w-0 flex-1 truncate text-sm">
        {m.browser_tabNotice_agentControl_label({ name: agentName })}
      </span>
      <Fa
        icon={faChevronRight}
        class="shrink-0 opacity-60 transition-transform duration-spring-fast ease-spring-fast group-hover:translate-x-0.5 motion-reduce:transition-none"
        size="xs"
      />
    </Button>
  </div>
{/if}
