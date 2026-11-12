<script lang="ts">
  import LinkSimpleIcon from 'phosphor-svelte/lib/LinkSimpleIcon';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { store as appStore } from '$store/renderer/store';
  import { selectDockLinkedContext } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    dockContextLinkRequested,
    dockContextUnlinkRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import type { DockContextLinkScope } from '$shared/dock-context-links';
  import { selectShortcutOverrides } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { resolveShortcut } from '$shared/keyboard-shortcut-bindings';
  import { formatShortcut } from '$lib/utils/shortcuts';

  /**
   * Link the current tab or app to the open workspace, from its conversation header. The
   * icon is always there; it opens a menu with Active tab and Active app, each with its real
   * tab title or app name muted on the same row, each checked when that scope's saved link
   * sends it here, under a line on what the configured open-dock shortcut does with a link. A choice the current context cannot save
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
  /**
   * Muted secondary text per choice: the real tab title and app name (optional display
   * metadata of the snapshot, never a key), else the context's own label for its kind.
   */
  const details = $derived({
    tab:
      context?.tabTitle?.trim() ||
      (context && context.identityKind !== 'app' ? context.label : '') ||
      null,
    app: context?.appName?.trim() || (context?.identityKind === 'app' ? context.label : '') || null,
  });
  /** The person's own open-dock shortcut (their override, else the default), as shown. */
  const overrides$ = selectShortcutOverrides();
  const openShortcut = $derived(formatShortcut(resolveShortcut('dock.focus', $overrides$)));
  const label = $derived(
    m.dock_linkedTab_link_ariaLabel({ context: context?.label || '', workspace: title }),
  );
</script>

<Menu.Root bind:open onOpenChange={opened}>
  <Menu.Trigger>
    {#snippet child({ props })}
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
  </Menu.Trigger>
  <Menu.Content
    align="end"
    side="bottom"
    sideOffset={4}
    collisionPadding={8}
    aria-label={m.dock_linkedTab_link_label()}
    class="dock-header-link-menu w-80 max-w-[calc(100vw-16px)]"
  >
    {#if openShortcut}
      <p class="dock-header-link-hint" data-link-shortcut-hint>
        {m.dock_linkedTab_shortcutHint_label({ shortcut: openShortcut })}
      </p>
    {/if}
    {#each SCOPES as scope (scope)}
      <!-- One choice per opening: the menu acts on what it showed when opened. -->
      <Menu.CheckboxItem
        checked={operations[scope] === 'unlink'}
        disabled={operations[scope] === null}
        closeOnSelect
        data-link-scope={scope}
        onSelect={() => choose(scope)}
      >
        <span class="flex min-w-0 flex-1 items-baseline gap-3">
          <span class="shrink-0 whitespace-nowrap"
            >{scope === 'tab'
              ? m.dock_linkedTab_thisTab_label()
              : m.dock_linkedTab_thisApp_label()}</span
          >
          {#if details[scope]}
            <span class="min-w-0 flex-1 truncate text-right" data-link-scope-detail
              >{details[scope]}</span
            >
          {/if}
        </span>
      </Menu.CheckboxItem>
    {/each}
  </Menu.Content>
</Menu.Root>

<style>
  /* Linked: this tab or app is linked here; the same quiet accent as other dock state. */
  /* The tab title / app name beside each choice: secondary, muted, one line. */
  :global(.dock-header-link-menu [data-link-scope-detail]) {
    color: hsl(var(--muted-foreground));
    font-size: 0.92em;
  }
  /* What the open-dock shortcut does with a link: a quiet, wrapping note above the choices. */
  :global(.dock-header-link-menu .dock-header-link-hint) {
    margin: 0 0 4px;
    padding: 4px 8px 7px;
    border-bottom: 1px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    line-height: 1.4;
  }
  :global(.dock-header-link[data-linked]) {
    color: hsl(var(--foreground));
    background-color: hsl(var(--dock-hover, var(--muted)));
  }
</style>
