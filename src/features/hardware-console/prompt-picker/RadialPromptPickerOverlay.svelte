<script lang="ts">
  /**
   * Joystick radial prompt picker overlay.
   *
   * Renders while the joystick is deflected past the dead-zone: the top-N
   * prompts plus a dedicated Cancel slot are placed around a circle —
   * Cancel sits at 6 o'clock and prompt i at `radialPromptTurn(i, N)`,
   * matching the service's sector math (`radial-layout.ts`). The
   * highlighted sector follows the stick; the component is purely
   * presentational — all input handling and insertion live in the
   * prompt-picker service.
   */
  import { fade, scale } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';
  import { selectHardwareConsoleRadialPrompt } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import { radialCancelSector, radialPromptTurn } from './radial-layout';

  const radial$ = selectHardwareConsoleRadialPrompt();

  const RADIUS_X = 260;
  const RADIUS_Y = 190;
  const MAX_LABEL_CHARS = 60;

  // Turn 0 = 12 o'clock, clockwise: x = sin, y = -cos.
  function positionAt(turn: number): { x: number; y: number } {
    const radians = turn * 2 * Math.PI;
    return { x: Math.sin(radians) * RADIUS_X, y: -Math.cos(radians) * RADIUS_Y };
  }

  const items = $derived(
    $radial$.prompts.map((text, index) => {
      const count = $radial$.prompts.length;
      return { text, index, ...positionAt(radialPromptTurn(index, count)) };
    }),
  );

  const cancelSector = $derived(radialCancelSector($radial$.prompts.length));
  const cancelPosition = positionAt(0.5);
  const cancelHighlighted = $derived(
    $radial$.sector === null || $radial$.sector === cancelSector,
  );

  function truncate(text: string): string {
    return text.length > MAX_LABEL_CHARS ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…` : text;
  }
</script>

{#if $radial$.open}
  <div
    class="radial-backdrop fixed inset-0 z-50"
    transition:fade={{ duration: 120 }}
    role="listbox"
    aria-label={m.hardwareConsole_radialPromptPicker_menu_ariaLabel()}
  >
    <div class="absolute inset-0 flex items-center justify-center">
      <div class="relative" transition:scale={{ duration: 140, start: 0.9 }}>
        <div class="radial-hub absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-2 text-xs">
          {#if cancelHighlighted}
            {m.hardwareConsole_radialPromptPicker_releaseToCancel_label()}
          {:else}
            {m.hardwareConsole_radialPromptPicker_releaseToInsert_label()}
          {/if}
        </div>
        {#each items as item (item.index)}
          <div
            class="radial-item absolute max-w-64 -translate-x-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-sm"
            class:radial-item-active={$radial$.sector === item.index}
            style="left: {item.x}px; top: {item.y}px;"
            role="option"
            aria-selected={$radial$.sector === item.index}
            title={item.text}
          >
            {truncate(item.text)}
          </div>
        {/each}
        <div
          class="radial-item radial-cancel absolute -translate-x-1/2 -translate-y-1/2 rounded-lg px-3 py-2 text-sm"
          class:radial-item-active={$radial$.sector === cancelSector}
          style="left: {cancelPosition.x}px; top: {cancelPosition.y}px;"
          role="option"
          aria-selected={$radial$.sector === cancelSector}
        >
          {m.hardwareConsole_radialPromptPicker_cancel_label()}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .radial-backdrop {
    background: color-mix(in srgb, var(--color-bg-primary, #0b0b10) 55%, transparent);
    backdrop-filter: blur(2px);
    pointer-events: none;
  }
  .radial-hub {
    background: var(--color-bg-secondary, #1a1a22);
    color: var(--color-text-secondary, #a0a0b0);
    border: 1px solid var(--color-border, #2c2c38);
    white-space: nowrap;
  }
  .radial-item {
    background: var(--color-bg-secondary, #1a1a22);
    color: var(--color-text-primary, #e8e8f0);
    border: 1px solid var(--color-border, #2c2c38);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .radial-item-active {
    background: var(--color-accent, #4c6fff);
    color: #fff;
    border-color: transparent;
  }
  /* Destructive styling for the Cancel sector, matching the app's
     destructive tokens (button/badge destructive variants). */
  .radial-cancel {
    background: var(--color-destructive, hsl(0 84% 95%));
    color: var(--color-destructive-foreground, hsl(0 92% 30%));
    border-color: color-mix(
      in srgb,
      var(--color-destructive-foreground, hsl(0 92% 30%)) 35%,
      transparent
    );
  }
  .radial-cancel.radial-item-active {
    background: var(--color-red-700, #b91c1c);
    color: #fff;
    border-color: transparent;
  }
  :global(.dark) .radial-cancel.radial-item-active {
    background: var(--color-red-600, #dc2626);
  }
</style>
