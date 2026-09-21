<script lang="ts">
  import Tooltip from './Tooltip.svelte';
  import { cn } from '$lib/utils.js';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import type { Snippet } from 'svelte';
  import { ShortcutChip } from '$lib/components/ui/kbd';

  interface Props {
    label: string;
    shortcut?: string | string[];
    /** Optional second action and its shortcut, shown on a separate line. */
    secondary?: { label: string; shortcut: string | string[] };
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    delayDuration?: number;
    disabled?: boolean;
    portalTarget?: Element | string;
    class?: string;
    contentClass?: string;
    /** Child elements to wrap with the tooltip trigger */
    children?: Snippet;
    /** Alternative trigger element */
    trigger?: Snippet;
  }

  let {
    label,
    shortcut,
    secondary,
    side = 'top',
    align = 'center',
    sideOffset = 4,
    delayDuration = 500,
    disabled = false,
    portalTarget,
    class: className = '',
    contentClass = '',
    children,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    trigger,
  }: Props = $props();

  // Detect OS for proper modifier key display
  const isMac = isMacPlatform();

  // Format shortcut keys
  function formatShortcutKey(key: string): string {
    const replacements: Record<string, string> = {
      mod: isMac ? '⌘' : 'Ctrl',
      cmd: isMac ? '⌘' : 'Ctrl',
      command: isMac ? '⌘' : 'Ctrl',
      ctrl: isMac ? '⌃' : 'Ctrl',
      control: isMac ? '⌃' : 'Ctrl',
      alt: isMac ? '⌥' : 'Alt',
      option: isMac ? '⌥' : 'Alt',
      shift: isMac ? '⇧' : 'Shift',
      enter: '↵',
      return: '↵',
      delete: '⌦',
      backspace: '⌫',
      escape: 'Esc',
      esc: 'Esc',
      tab: '⇥',
      space: '␣',
      up: '↑',
      down: '↓',
      left: '←',
      right: '→',
      arrowup: '↑',
      arrowdown: '↓',
      arrowleft: '←',
      arrowright: '→',
      pageup: 'PgUp',
      pagedown: 'PgDn',
      home: 'Home',
      end: 'End',
    };

    const lowerKey = key.toLowerCase();
    return replacements[lowerKey] || key.toUpperCase();
  }

  // Process shortcut array or string
  function processShortcut(shortcut: string | string[]): string[] {
    if (Array.isArray(shortcut)) {
      return shortcut.map(formatShortcutKey);
    }
    return shortcut.split('+').map((k) => formatShortcutKey(k.trim()));
  }

  // Use $derived to react to prop changes
  const formattedShortcut = $derived(shortcut ? processShortcut(shortcut) : []);
  const formattedSecondaryShortcut = $derived(secondary ? processShortcut(secondary.shortcut) : []);
</script>

{#snippet shortcutLine(text: string, keys: string[])}
  <span class="type-caption">{text}</span>
  {#if keys.length > 0}
    <div class="flex items-center gap-1 text-muted-foreground">
      <!-- a11y-ignore -->
      {#each keys as key, i (`key-${i}-${key}`)}
        <ShortcutChip>{key}</ShortcutChip>
      {/each}
    </div>
  {/if}
{/snippet}

<Tooltip
  {side}
  {align}
  {sideOffset}
  {delayDuration}
  {disabled}
  {portalTarget}
  class={className}
  contentClass={cn(
    secondary ? 'flex flex-col items-stretch gap-1.5' : 'flex items-center gap-3',
    contentClass,
  )}
>
  {#snippet trigger()}
    {#if children}
      {@render children?.()}
    {:else if trigger}
      {@render trigger?.()}
    {/if}
  {/snippet}

  {#snippet content()}
    {#if secondary}
      <div class="flex items-center justify-between gap-3">
        {@render shortcutLine(label, formattedShortcut)}
      </div>
      <div class="flex items-center justify-between gap-3">
        {@render shortcutLine(secondary.label, formattedSecondaryShortcut)}
      </div>
    {:else}
      {@render shortcutLine(label, formattedShortcut)}
    {/if}
  {/snippet}
</Tooltip>
