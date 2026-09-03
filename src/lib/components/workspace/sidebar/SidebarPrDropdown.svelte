<script lang="ts">
  import Fa from 'svelte-fa';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { handleLink } from '$features/navigation/link-handler';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import SidebarPrList from './SidebarPrList.svelte';
  import type { WorkspacePRPresentationRow } from './workspace-pr-presentation';

  let {
    rows,
    workspaceId,
    side = 'top',
    align = 'end',
    class: className = '',
  }: {
    rows: WorkspacePRPresentationRow[];
    workspaceId: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    class?: string;
  } = $props();

  let open = $state(false);

  // Rows arrive sorted earliest-in-flow first (draft → open → merged → closed);
  // the lead row drives the trigger glyph.
  const leadRow = $derived(rows[0]);
  const triggerLabel = $derived(
    m.workspace_sidebarPrDropdown_trigger_ariaLabel({ count: formatInteger(rows.length) }),
  );

  // Escape ordering: while open, occupy the top of the escape-layer stack so
  // underlying overlays (e.g. an expanded sidebar panel) do not also dismiss on
  // the same keypress. Decline (return false) so bits-ui still closes the menu.
  $effect(() => {
    if (!open) return;
    return pushEscapeLayer(() => false);
  });

  // The launcher card behind this control expands the Changes tab on click, so
  // trigger events must not bubble past the dropdown. Menu content is portaled
  // and therefore never inside the launcher's DOM subtree.
  function isolate<E extends Event>(next: ((event: E) => void) | undefined) {
    return (event: E) => {
      event.stopPropagation();
      next?.(event);
    };
  }

  function close() {
    open = false;
  }

  function openPr(pr: WorkspacePRPresentationRow, close: () => void) {
    close();
    if (!pr.url) return;
    handleLink(pr.url, { workspaceId: WorkspaceId(workspaceId) });
  }
</script>

{#if leadRow}
  <span class="pointer-events-auto relative z-20 inline-flex {className}" data-sidebar-pr-dropdown>
    <Menu.Root bind:open>
      <Menu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="plain"
            size="icon"
            class="relative size-6 shrink-0 cursor-pointer rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:bg-background/80 focus-visible:text-foreground"
            aria-label={triggerLabel}
            title={triggerLabel}
            data-sidebar-pr-trigger
            data-sidebar-pr-count={rows.length}
            onpointerdown={isolate(
              props.onpointerdown as ((event: PointerEvent) => void) | undefined,
            )}
            onclick={isolate(props.onclick as ((event: MouseEvent) => void) | undefined)}
          >
            <Fa icon={leadRow.statusIcon} class="size-4! {leadRow.foregroundClass}" />
            {#if rows.length > 1}
              <Badge
                variant="secondary"
                class="absolute -right-1.5 -top-1.5 h-4 min-w-4 px-1 text-xs leading-none tabular-nums ring-1 ring-background"
                aria-hidden="true"
                data-sidebar-pr-count-badge
              >
                {formatInteger(rows.length)}
              </Badge>
            {/if}
          </Button>
        {/snippet}
      </Menu.Trigger>
      <Menu.Content
        {side}
        {align}
        collisionPadding={8}
        preventScroll={false}
        class="w-80"
        maxHeight="min(var(--bits-dropdown-menu-content-available-height, 100dvh), 22rem)"
        aria-label={triggerLabel}
      >
        <SidebarPrList {rows} onSelect={(pr) => openPr(pr, close)} />
      </Menu.Content>
    </Menu.Root>
  </span>
{/if}
