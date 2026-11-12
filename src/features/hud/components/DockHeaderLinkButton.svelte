<script lang="ts">
  import LinkSimpleIcon from 'phosphor-svelte/lib/LinkSimpleIcon';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { ActionMenu, defineActions } from '$lib/components/patterns/action-menu';
  import { store as appStore } from '$store/renderer/store';
  import { selectDockLinkedContext } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    dockContextLinkRequested,
    dockContextUnlinkRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import type { DockContextLinkScope } from '$shared/dock-context-links';

  /**
   * Link the current tab or app to the open workspace, from its conversation header. The
   * icon is always there; it opens a menu with This tab and This app, each checked when
   * that scope's saved link sends it here. A choice the current context cannot save
   * (unknown, the dock itself, no exact tab or app) is shown disabled. Choosing links that
   * scope here, or unlinks exactly that scope's saved link; never the effective link of
   * another scope. The menu's popup is owned by the dock conversation (it keeps the dock
   * open while used). Checked state follows only the confirmed snapshot.
   */
  let { workspaceId, title }: { workspaceId: string; title: string } = $props();
  const context$ = selectDockLinkedContext();
  const context = $derived($context$);
  const SCOPES: readonly DockContextLinkScope[] = ['tab', 'app'];
  type Operation = 'link' | 'unlink' | null;
  /** What choosing `scope` would do now: null when the context cannot save it. */
  function operationOf(scope: DockContextLinkScope): Operation {
    const link = context?.phase === 'ready' ? context.linkScopes?.[scope] : undefined;
    if (!link) return null;
    if (link.savedWorkspaceId === workspaceId && link.revision > 0) return 'unlink';
    return link.available && link.key ? 'link' : null;
  }
  const operations = $derived({ tab: operationOf('tab'), app: operationOf('app') });
  const linkedHere = $derived(SCOPES.some((scope) => operations[scope] === 'unlink'));

  let open = $state(false);
  /**
   * The menu acts on what it showed when it opened: {workspace, version, operation per
   * scope}. If the workspace, the context or a choice's operation changes meanwhile, that
   * choice does nothing (no fallback to the new target); a new workspace or context closes
   * the menu. A choice dispatches the captured target, never the current one.
   */
  let held: {
    workspaceId: string;
    version: string;
    operations: Record<DockContextLinkScope, Operation>;
  } | null = null;
  function opened(next: boolean): void {
    held =
      next && context?.contextVersion
        ? { workspaceId, version: context.contextVersion, operations: { ...operations } }
        : null;
  }
  $effect(() => {
    const version = context?.contextVersion;
    const target = workspaceId;
    if (open && held && (held.version !== version || held.workspaceId !== target)) open = false;
  });
  function choose(id: string): void {
    const scope = SCOPES.find((value) => value === id);
    const gesture = held;
    held = null;
    if (!scope || !gesture) return;
    if (context?.contextVersion !== gesture.version || workspaceId !== gesture.workspaceId) return;
    const now = operations[scope];
    if (!now || now !== gesture.operations[scope]) return;
    if (now === 'unlink') appStore.dispatch(dockContextUnlinkRequested(gesture.version, scope));
    else appStore.dispatch(dockContextLinkRequested(gesture.version, gesture.workspaceId, scope));
  }
  const actions = $derived(
    defineActions(
      SCOPES.map((scope) => ({
        id: scope,
        kind: 'checkbox' as const,
        label:
          scope === 'tab' ? m.dock_linkedTab_thisTab_label() : m.dock_linkedTab_thisApp_label(),
        checked: operations[scope] === 'unlink',
        disabled: operations[scope] === null,
        // One choice per opening: the menu acts on what it showed when opened.
        closeOnSelect: true,
      })),
    ),
  );
  const label = $derived(
    m.dock_linkedTab_link_ariaLabel({ context: context?.label || '', workspace: title }),
  );
</script>

<ActionMenu
  bind:open
  {actions}
  ariaLabel={m.dock_linkedTab_link_label()}
  align="end"
  side="bottom"
  class="dock-header-link-menu min-w-40"
  onOpenChange={opened}
  onAction={choose}
>
  {#snippet trigger({ props })}
    <Button
      {...props}
      variant="ghost"
      size="icon-sm"
      class="dock-header-link"
      data-dock-header-link
      data-linked={linkedHere || undefined}
      data-context-version={context?.contextVersion}
      aria-label={context?.label ? label : m.dock_linkedTab_link_label()}
      tooltipContentClass="dock-chrome-tooltip max-w-64 whitespace-normal"
      tooltipSide="bottom"
      tooltipAlign="end"
      tooltip={context?.label ? label : m.dock_linkedTab_link_label()}
      tooltipDisabled={open}
      ><LinkSimpleIcon size={15} weight={linkedHere ? 'bold' : 'regular'} /></Button
    >
  {/snippet}
</ActionMenu>

<style>
  /* Linked: this tab or app is linked here; the same quiet accent as other dock state. */
  :global(.dock-header-link[data-linked]) {
    color: hsl(var(--dock-accent, var(--foreground)));
    background-color: hsl(var(--dock-hover, var(--muted)));
  }
</style>
