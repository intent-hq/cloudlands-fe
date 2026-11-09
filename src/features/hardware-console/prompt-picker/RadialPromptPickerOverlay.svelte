<script lang="ts">
  /**
   * Joystick radial prompt picker overlay.
   *
   * Renders while the joystick is deflected past the dead-zone: an 8-direction
   * ring of curved labels (see `radial-layout.ts`). Chat suggestions sit at
   * top, top-right and right with a number pill; Cancel sits at the bottom.
   * Bottom labels are flipped so they read upright, and the ring grows until
   * every label fits its arc. Purely presentational — input handling, send
   * and insertion live in the prompt-picker service.
   */
  import { innerHeight, innerWidth } from 'svelte/reactivity/window';
  import { fade, scale } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import { selectHardwareConsoleRadialPrompt } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import {
    RADIAL_SLOT_COUNT,
    RADIAL_SLOT_GAP_TURNS,
    buildRadialSlots,
    fitRadialLabels,
    radialSlotTurn,
    type RadialSlot,
  } from './radial-layout';

  const radial$ = selectHardwareConsoleRadialPrompt();
  const uid = $props.id();

  const FONT_SIZE = 13;
  const LINE_HEIGHT = 16;
  const BAND = LINE_HEIGHT * 2 + 22;
  const MIN_RADIUS = 140;
  const MAX_RADIUS = 300;
  const EDGE_MARGIN = 12;

  let measureContext: CanvasRenderingContext2D | null = null;
  function measure(text: string): number {
    if (typeof document === 'undefined') return text.length * FONT_SIZE * 0.55;
    if (!measureContext) {
      measureContext = document.createElement('canvas').getContext('2d');
      if (measureContext) {
        const family = getComputedStyle(document.body).fontFamily;
        measureContext.font = `500 ${FONT_SIZE}px ${family}`;
      }
    }
    return measureContext?.measureText(text).width ?? text.length * FONT_SIZE * 0.55;
  }

  function slotLabel(slot: RadialSlot): string {
    if (slot.kind === 'cancel') return m.hardwareConsole_radialPromptPicker_cancel_label();
    if (slot.kind === 'empty') return '';
    return slot.label;
  }

  // Degrees clockwise from 12 o'clock → SVG point around (0, 0).
  function point(degrees: number, radius: number): [number, number] {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return [radius * Math.cos(radians), radius * Math.sin(radians)];
  }

  function arc(from: number, to: number, radius: number, clockwise: boolean): string {
    const [x0, y0] = point(from, radius);
    const [x1, y1] = point(to, radius);
    return `M${x0} ${y0} A${radius} ${radius} 0 0 ${clockwise ? 1 : 0} ${x1} ${y1}`;
  }

  // Split out so a sector change (new store object, same lists) does not
  // rebuild the slots or rerun label fitting.
  const suggestions = $derived($radial$.suggestions);
  const prompts = $derived($radial$.prompts);
  const slots = $derived(buildRadialSlots(suggestions, prompts));

  const ring = $derived.by(() => {
    const viewport = Math.min(innerWidth.current ?? 1200, innerHeight.current ?? 900);
    const maxRadius = Math.max(
      MIN_RADIUS,
      Math.min(MAX_RADIUS, viewport / 2 - BAND / 2 - EDGE_MARGIN),
    );
    const fit = fitRadialLabels(slots.map(slotLabel), {
      measure,
      minRadius: MIN_RADIUS,
      maxRadius,
    });
    const radius = fit.radius;
    const inner = radius - BAND / 2;
    const outer = radius + BAND / 2;
    const halfSpan = 180 / RADIAL_SLOT_COUNT - (RADIAL_SLOT_GAP_TURNS * 360) / 2;

    const items = slots.map((slot, index) => {
      const center = radialSlotTurn(index) * 360;
      const start = center - halfSpan;
      const end = center + halfSpan;
      // Labels in the bottom half run right-to-left along the ring, so draw
      // them on a reversed arc to keep the text upright.
      const flipped = center > 90 && center < 270;
      const lines = fit.lines[index].map((text, line, all) => {
        const offset = (line - (all.length - 1) / 2) * LINE_HEIGHT;
        const lineRadius = flipped ? radius + offset : radius - offset;
        return {
          text,
          id: `${uid}-slot${index}-line${line}`,
          path: flipped ? arc(end, start, lineRadius, false) : arc(start, end, lineRadius, true),
        };
      });
      const [ox0, oy0] = point(start, outer);
      const [ox1, oy1] = point(end, outer);
      const [ix1, iy1] = point(end, inner);
      const [ix0, iy0] = point(start, inner);
      const wedge = `M${ox0} ${oy0} A${outer} ${outer} 0 0 1 ${ox1} ${oy1} L${ix1} ${iy1} A${inner} ${inner} 0 0 0 ${ix0} ${iy0} Z`;
      const pill = slot.kind === 'suggestion' ? point(center, inner - 14) : null;
      return { slot, index, wedge, lines, pill };
    });
    return { items, size: Math.ceil(outer + 2) * 2 };
  });

  const highlighted = $derived($radial$.sector === null ? null : (slots[$radial$.sector] ?? null));
  const hubLabel = $derived(
    highlighted?.kind === 'suggestion'
      ? m.hardwareConsole_radialPromptPicker_releaseToSend_label()
      : highlighted?.kind === 'prompt'
        ? m.hardwareConsole_radialPromptPicker_releaseToInsert_label()
        : m.hardwareConsole_radialPromptPicker_releaseToCancel_label(),
  );
  const statusLabel = $derived(
    highlighted?.kind === 'suggestion' || highlighted?.kind === 'prompt'
      ? highlighted.label
      : m.hardwareConsole_radialPromptPicker_cancel_label(),
  );
</script>

{#if $radial$.open}
  <div
    class="radial-backdrop fixed inset-0 z-50"
    transition:fade={{ tier: 'moderate' }}
    role="region"
    aria-label={m.hardwareConsole_radialPromptPicker_menu_ariaLabel()}
  >
    <p class="sr-only" role="status" aria-atomic="true">
      {statusLabel}
      {m.hardwareConsole_radialPromptPicker_keyboard_description()}
    </p>
    <div class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <div class="relative" transition:scale={{ tier: 'moderate', distance: 0.1 }}>
        <svg
          class="radial-ring"
          width={ring.size}
          height={ring.size}
          viewBox="{-ring.size / 2} {-ring.size / 2} {ring.size} {ring.size}"
          style="font-size: {FONT_SIZE}px;"
        >
          {#each ring.items as item (item.index)}
            <g
              class="radial-slot radial-slot-{item.slot.kind}"
              class:radial-slot-active={$radial$.sector === item.index}
            >
              <path class="radial-wedge" d={item.wedge} />
              {#each item.lines as line (line.id)}
                <path id={line.id} d={line.path} fill="none" />
                <text class="radial-label" dominant-baseline="central">
                  <textPath href="#{line.id}" startOffset="50%" text-anchor="middle"
                    >{line.text}</textPath
                  >
                </text>
              {/each}
              {#if item.pill && item.slot.kind === 'suggestion'}
                <rect
                  class="radial-pill"
                  x={item.pill[0] - 10}
                  y={item.pill[1] - 8}
                  width="20"
                  height="16"
                  rx="8"
                />
                <text
                  class="radial-pill-number"
                  x={item.pill[0]}
                  y={item.pill[1]}
                  text-anchor="middle"
                  dominant-baseline="central">{item.slot.number}</text
                >
              {/if}
            </g>
          {/each}
        </svg>
        <div
          class="radial-hub absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-2 text-xs"
        >
          {hubLabel}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .radial-backdrop {
    background: color-mix(in srgb, hsl(var(--background)) 55%, transparent);
    backdrop-filter: blur(2px);
    pointer-events: none;
    --radial-suggestion: var(--color-violet-600, #7c3aed);
  }
  :global(.dark) .radial-backdrop {
    --radial-suggestion: var(--color-violet-300, #c4b5fd);
  }
  .radial-ring {
    display: block;
    overflow: visible;
  }
  .radial-hub {
    background: hsl(var(--card));
    color: hsl(var(--muted-foreground));
    border: 1px solid hsl(var(--border));
    white-space: nowrap;
  }
  .radial-wedge {
    fill: hsl(var(--card));
    stroke: hsl(var(--border));
    stroke-width: 1;
    transition:
      fill 120ms ease-out,
      stroke 120ms ease-out;
  }
  .radial-label {
    fill: hsl(var(--foreground));
    font-weight: 500;
  }
  .radial-slot-empty .radial-wedge {
    fill: color-mix(in srgb, hsl(var(--card)) 45%, transparent);
    stroke: color-mix(in srgb, hsl(var(--border)) 50%, transparent);
  }
  .radial-slot-suggestion .radial-wedge {
    fill: color-mix(in srgb, var(--radial-suggestion) 14%, hsl(var(--card)));
    stroke: color-mix(in srgb, var(--radial-suggestion) 40%, transparent);
  }
  .radial-slot-suggestion .radial-label {
    fill: var(--radial-suggestion);
  }
  .radial-pill {
    fill: var(--radial-suggestion);
  }
  .radial-pill-number {
    fill: hsl(var(--background));
    font-size: 11px;
    font-weight: 700;
  }
  /* Destructive styling for Cancel, matching the app's destructive tokens. */
  .radial-slot-cancel .radial-wedge {
    fill: var(--color-danger-background, hsl(0 84% 95%));
    stroke: color-mix(in srgb, var(--color-danger, hsl(0 92% 30%)) 35%, transparent);
  }
  .radial-slot-cancel .radial-label {
    fill: var(--color-danger, hsl(0 92% 30%));
  }
  .radial-slot-active .radial-wedge {
    fill: hsl(var(--primary));
    stroke: transparent;
  }
  .radial-slot-active .radial-label,
  .radial-slot-active .radial-pill-number {
    fill: hsl(var(--primary-foreground));
  }
  .radial-slot-active .radial-pill {
    fill: hsl(var(--primary));
  }
  .radial-slot-cancel.radial-slot-active .radial-label {
    fill: #fff;
  }
  .radial-slot-cancel.radial-slot-active .radial-wedge {
    fill: var(--color-red-700, #b91c1c);
  }
  :global(.dark) .radial-slot-cancel.radial-slot-active .radial-wedge {
    fill: var(--color-red-600, #dc2626);
  }
  @container style(--motion-reduced: 1) {
    .radial-wedge {
      transition: none;
    }
  }
</style>
