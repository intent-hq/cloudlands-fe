<script module lang="ts">
  import { Button } from '$lib/components/ui/button';
  let closeActiveMenu: (() => void) | null = null;
</script>

<script lang="ts">
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import * as Menu from '$lib/components/ui/menu';
  import { onDestroy, tick, untrack, type Snippet } from 'svelte';
  import { resolveActions } from './actions';
  import type { ActionDefinition, ActionHandler, ResolvedAction } from './types';

  let {
    actions,
    onAction,
    trigger,
    contextMenu,
    onOpenChange,
    ariaLabel,
    open = $bindable(false),
    align = 'start',
    side = 'bottom',
    class: className,
  }: {
    actions: readonly ActionDefinition[];
    onAction?: ActionHandler;
    trigger?: Snippet<[{ props: Record<string, unknown>; open: boolean }]>;
    contextMenu?: { x: number; y: number; returnFocus?: HTMLElement | null };
    onOpenChange?: (open: boolean) => void;
    ariaLabel: string;
    open?: boolean;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
    class?: string;
  } = $props();

  const resolvedActions = $derived(resolveActions(actions));

  const uid = $props.id();
  let invokingElement: HTMLElement | null = null;
  let content: HTMLDivElement | null = $state(null);
  let previousContext: typeof contextMenu;
  let tabDismissed = false;
  let fallbackTargets: HTMLElement[] = [];

  function focusCandidates() {
    return Array.from(
      document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]'),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[data-action-menu-owner],[aria-hidden="true"],[inert]'),
    );
  }

  $effect(() => {
    if (!contextMenu) return;
    const { x, y, returnFocus } = contextMenu;
    if (
      previousContext?.x === x &&
      previousContext?.y === y &&
      previousContext?.returnFocus === returnFocus
    )
      return;
    previousContext = { x, y, returnFocus };
    untrack(() => {
      invokingElement =
        returnFocus ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      const candidates = focusCandidates();
      const after = candidates.filter(
        (element) =>
          invokingElement &&
          !!(invokingElement.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
      const before = candidates
        .filter(
          (element) =>
            invokingElement &&
            !!(invokingElement.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING),
        )
        .reverse();
      fallbackTargets = [...after, ...before];
      tabDismissed = false;
      open = true;
    });
  });

  function select(action: ResolvedAction, event: Event) {
    if (action.disabled || action.disabledReason !== undefined) return;
    onAction?.(action.id, event);
  }

  function close() {
    open = false;
    onOpenChange?.(false);
  }

  function restoreContextFocus(event: Event) {
    if (!contextMenu) return;
    event.preventDefault();
    if (tabDismissed) return;
    const active = document.activeElement;
    // Do not steal focus from a dialog or destination opened by the action.
    if (
      active !== document.body &&
      active !== content &&
      !(
        active instanceof Element &&
        active.closest('[data-action-menu-owner]')?.getAttribute('data-action-menu-owner') === uid
      )
    )
      return;
    const target = invokingElement?.isConnected
      ? invokingElement
      : fallbackTargets.find(
          (element) =>
            element.isConnected &&
            !element.matches(':disabled') &&
            !element.closest('[hidden],[inert],[aria-hidden="true"]'),
        );
    target?.focus({ preventScroll: true });
  }

  function handleContextKeydown(event: KeyboardEvent) {
    if (!contextMenu || event.key !== 'Tab' || event.defaultPrevented) return;
    event.preventDefault();
    const source = invokingElement;
    const candidates = focusCandidates().filter((element) => element.getClientRects().length > 0);
    const ordered = event.shiftKey ? candidates.reverse() : candidates;
    const next = source?.isConnected
      ? ordered.find(
          (element) =>
            element !== source &&
            !!(
              source.compareDocumentPosition(element) &
              (event.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)
            ),
        )
      : undefined;
    tabDismissed = true;
    close();
    void tick().then(() =>
      (next ?? (source?.isConnected ? source : null))?.focus({ preventScroll: true }),
    );
  }

  $effect(() => {
    if (!open) {
      if (closeActiveMenu === close) closeActiveMenu = null;
      return;
    }
    const previousClose = closeActiveMenu;
    closeActiveMenu = close;
    if (previousClose && previousClose !== close) previousClose();
  });

  onDestroy(() => {
    if (closeActiveMenu === close) closeActiveMenu = null;
  });
</script>

{#snippet itemContent(action: ResolvedAction)}
  <span class="min-w-0 flex-1">
    <span class="block truncate">{action.label}</span>
    {#if action.disabledReason}
      <span class="block text-muted-foreground" aria-hidden="true">{action.disabledReason}</span>
    {/if}
  </span>
  {#if action.shortcut}
    <span class="ml-5 flex h-lh shrink-0 items-center" aria-hidden="true"
      ><ShortcutChip>{action.shortcut}</ShortcutChip></span
    >
  {/if}
{/snippet}

{#snippet groupLabel(action: ResolvedAction)}
  <Menu.Label icon={action.icon}>
    <span>{action.label}</span>
  </Menu.Label>
{/snippet}

{#snippet actionItem(action: ResolvedAction)}
  {@const disabled = action.disabled || action.disabledReason !== undefined}
  {@const descriptionId = action.disabledReason ? `${uid}-${action.id}-reason` : undefined}
  {#snippet leading()}
    {#if action.icon}
      <Fa
        icon={action.icon}
        size={16}
        class={action.destructive ? 'size-4 text-current' : 'size-4 text-muted-foreground'}
      />
    {/if}
  {/snippet}
  {#if action.kind === 'label'}
    <Menu.Group>{@render groupLabel(action)}</Menu.Group>
  {:else if action.kind === 'section'}
    <Menu.Group aria-label={action.label}>
      {@render groupLabel(action)}
      {@render actionItems(action.children, disabled)}
    </Menu.Group>
  {:else if action.kind === 'radio-group'}
    <Menu.RadioGroup value={action.value} aria-label={action.label}>
      {@render groupLabel(action)}
      {@render actionItems(action.children, disabled)}
    </Menu.RadioGroup>
  {:else if action.children?.length}
    <Menu.Sub>
      <Menu.SubTrigger
        icon={action.icon}
        {disabled}
        aria-describedby={descriptionId}
        data-action-id={action.id}
      >
        {@render itemContent(action)}
      </Menu.SubTrigger>
      <Menu.SubContent
        collisionPadding={8}
        data-action-menu-owner={uid}
        onkeydown={handleContextKeydown}
      >
        {@render actionItems(action.children)}
      </Menu.SubContent>
    </Menu.Sub>
  {:else if action.kind === 'radio'}
    <Menu.RadioItem
      value={action.value}
      leading={action.icon ? leading : undefined}
      {disabled}
      aria-describedby={descriptionId}
      closeOnSelect={action.closeOnSelect ?? false}
      onSelect={(event) => select(action, event)}
      data-action-id={action.id}
    >
      {@render itemContent(action)}
    </Menu.RadioItem>
  {:else if action.checked !== undefined}
    <Menu.CheckboxItem
      checked={action.checked}
      leading={action.icon ? leading : undefined}
      indeterminate={action.kind === 'checkbox' && action.indeterminate}
      {disabled}
      aria-describedby={descriptionId}
      closeOnSelect={action.closeOnSelect ?? false}
      onSelect={(event) => select(action, event)}
      data-action-id={action.id}
    >
      {@render itemContent(action)}
    </Menu.CheckboxItem>
  {:else}
    <Menu.Item
      {disabled}
      leading={action.icon ? leading : undefined}
      destructive={action.destructive}
      aria-describedby={descriptionId}
      closeOnSelect={action.closeOnSelect ?? true}
      onSelect={(event) => select(action, event)}
      data-action-id={action.id}
    >
      {@render itemContent(action)}
    </Menu.Item>
  {/if}
  {#if action.disabledReason}
    <span id={descriptionId} class="sr-only">{action.disabledReason}</span>
  {/if}
{/snippet}

{#snippet actionItems(entries: readonly ResolvedAction[], disabled = false)}
  {#each entries as action, index (action.id)}
    {#if index > 0 && (action.group !== entries[index - 1]?.group || action.kind === 'section' || action.kind === 'radio-group' || entries[index - 1]?.kind === 'section' || entries[index - 1]?.kind === 'radio-group')}
      <Menu.Separator />
    {/if}
    {@render actionItem(disabled ? { ...action, disabled: true } : action)}
  {/each}
{/snippet}

<Menu.Root bind:open {onOpenChange}>
  <Menu.Trigger>
    {#snippet child({ props })}
      {#if contextMenu}
        <Button
          {...props}
          type="button"
          aria-label={ariaLabel}
          aria-hidden="true"
          tabindex={-1}
          class="pointer-events-none fixed size-px opacity-0"
          style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px;`}
        ></Button>
      {:else}
        {@render trigger?.({ props, open })}
      {/if}
    {/snippet}
  </Menu.Trigger>
  <Menu.Content
    alignIconColumn
    bind:ref={content}
    {align}
    {side}
    sideOffset={contextMenu ? 0 : 4}
    collisionPadding={8}
    aria-label={ariaLabel}
    data-action-menu-owner={uid}
    onCloseAutoFocus={restoreContextFocus}
    onkeydown={handleContextKeydown}
    class={className}
  >
    {@render actionItems(resolvedActions)}
  </Menu.Content>
</Menu.Root>
