<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { effectiveShortcutReadable } from '$lib/utils/effective-shortcuts';
  import {
    matchSwitcherChord,
    type RecentAgentEntry,
    type RecentAgentPageKey,
  } from '$shared/recent-agents';
  import { onRecentAgentPageKey } from './page-key-forwarding';
  import {
    selectConnectedIds,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { selectRecentAgents } from '$store/renderer/slices/recent-agents/recent-agents-selectors';
  import { recentAgentOpenRequested } from '$store/renderer/slices/recent-agents/recent-agents-slice';
  import { selectCurrentlyViewedAgentId } from '$store/renderer/slices/unread-tracking/unread-tracking-selectors';
  import { store as appStore } from '$store/renderer/store';
  import RecentAgentSwitcherView from './RecentAgentSwitcherView.svelte';
  import {
    isSwitcherModifierKeyUp,
    isSwitcherModifierReleased,
    stepSwitcher,
    switcherHeldModifiers,
    SWITCHER_CLOSED,
    type SwitcherEvent,
    type SwitcherState,
  } from './utils/recent-agent-switcher';

  const binding$ = effectiveShortcutReadable('navigation.recent-agents');
  const recentAgents$ = selectRecentAgents();
  const currentConnectionId$ = selectCurrentConnectionId();
  const connectedIds$ = selectConnectedIds();
  const viewedAgentId$ = selectCurrentlyViewedAgentId();

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  let switcher = $state<SwitcherState>(SWITCHER_CLOSED);
  /** The list as it was when the switcher opened; pushes do not reorder it mid-switch. */
  let entries = $state<RecentAgentEntry[]>([]);
  let held: ReturnType<typeof switcherHeldModifiers> = null;
  let returnFocus: HTMLElement | null = null;
  let listbox = $state<HTMLElement | null>(null);

  const selectedIndex = $derived(switcher.open ? switcher.index : -1);

  function isOffline(entry: RecentAgentEntry): boolean {
    return (
      entry.connectionId !== $currentConnectionId$ && !$connectedIds$.includes(entry.connectionId)
    );
  }

  function isShown(entry: RecentAgentEntry): boolean {
    return entry.connectionId === $currentConnectionId$ && entry.agentId === $viewedAgentId$;
  }

  function apply(event: SwitcherEvent): void {
    const wasOpen = switcher.open;
    const step = stepSwitcher(switcher, event, entries.length);
    switcher = step.state;
    if (!wasOpen && step.state.open) void focusList();
    if (wasOpen && !step.state.open) {
      const chosen = step.open === undefined ? undefined : entries[step.open];
      if (chosen && !isShown(chosen)) {
        returnFocus = null;
        appStore.dispatch(recentAgentOpenRequested(chosen));
      } else {
        returnFocus?.focus?.();
        returnFocus = null;
      }
    }
  }

  /** Take focus from the composer, a terminal or a page so later keys reach the switcher. */
  async function focusList(): Promise<void> {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await tick();
    listbox?.focus({ preventScroll: true });
  }

  /** A DOM key event, or one a browser-panel page forwarded through main. */
  type SwitcherKey = Omit<RecentAgentPageKey, 'type'> &
    Partial<Pick<KeyboardEvent, 'preventDefault' | 'stopPropagation' | 'target' | 'repeat'>>;

  /** Settings → Keyboard shortcuts records the next chord; it must receive the switcher's too. */
  function isShortcutCapture(event: SwitcherKey): boolean {
    return (
      event.target instanceof Element && event.target.closest('[data-shortcut-input]') !== null
    );
  }

  function swallow(event: SwitcherKey): void {
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  function onKeydown(event: SwitcherKey): void {
    if (!switcher.open) {
      if (isShortcutCapture(event)) return;
      // Only the chord itself opens the switcher; Shift moves back once it is open.
      if (matchSwitcherChord(event, $binding$, isMac) !== 'forward') return;
      if ($recentAgents$.length === 0) return;
      swallow(event);
      entries = [...$recentAgents$];
      held = switcherHeldModifiers($binding$, isMac);
      apply({ type: 'chord', backwards: false, sticky: held === null });
      return;
    }
    swallow(event);
    // Holding Tab must not race through the list: one press, one step.
    if (event.repeat) return;
    // The release happened while another window had the keys.
    if (held && isSwitcherModifierReleased(held, event)) {
      apply({ type: 'release' });
      return;
    }
    // The chord itself moves, whatever its key (e.g. a custom Ctrl+F6).
    const direction = matchSwitcherChord(event, $binding$, isMac);
    if (direction) {
      apply({ type: 'chord', backwards: direction === 'backward', sticky: false });
      return;
    }
    if (event.key === 'Escape') apply({ type: 'cancel' });
    else if (event.key === 'Enter') apply({ type: 'confirm' });
    else if (event.key === 'Tab')
      apply({ type: 'chord', backwards: event.shiftKey, sticky: false });
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      apply({ type: 'move', delta: 1 });
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      apply({ type: 'move', delta: -1 });
  }

  function onKeyup(event: SwitcherKey): void {
    if (!switcher.open) return;
    swallow(event);
    if (held && isSwitcherModifierKeyUp(held, event)) apply({ type: 'release' });
  }

  function onBlur(): void {
    if (switcher.open) apply({ type: 'cancel' });
  }

  onMount(() => {
    // Capture on window: runs before the composer, xterm and other key handlers.
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('keyup', onKeyup, true);
    window.addEventListener('blur', onBlur);
    const stopPageKeys = onRecentAgentPageKey((key) =>
      key.type === 'keydown' ? onKeydown(key) : onKeyup(key),
    );
    return () => {
      stopPageKeys();
      window.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('keyup', onKeyup, true);
      window.removeEventListener('blur', onBlur);
    };
  });
</script>

{#if switcher.open}
  <RecentAgentSwitcherView
    {entries}
    {selectedIndex}
    currentConnectionId={$currentConnectionId$}
    {isOffline}
    bind:listbox
    onpoint={(index) => apply({ type: 'point', index })}
    onchoose={(index) => {
      apply({ type: 'point', index });
      apply({ type: 'confirm' });
    }}
  />
{/if}
