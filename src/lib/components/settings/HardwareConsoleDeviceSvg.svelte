<script lang="ts" module>
  import { m } from '$shared/paraglide/messages.js';
  import {
    faBolt,
    faCheck,
    faCodeBranch,
    faMicrophone,
    faTerminal,
    faXmark,
    type IconDefinition,
  } from '@fortawesome/free-solid-svg-icons';

  const CODEX_CAP_LABELS: readonly (() => string)[] = [
    () => m.settings_hardware_codexCap_lightning_label(),
    () => m.settings_hardware_codexCap_checkmark_label(),
    () => m.settings_hardware_codexCap_xmark_label(),
    () => m.settings_hardware_codexCap_branching_label(),
    () => m.settings_hardware_codexCap_micLeft_label(),
    () => m.settings_hardware_codexCap_micRight_label(),
    () => m.settings_hardware_codexCap_logo_label(),
  ];

  /** Printed-cap name for a Codex Micro action-key slot (0-based). */
  export function codexCapLabel(slot: number): string {
    return CODEX_CAP_LABELS[slot]?.() ?? '';
  }

  /** Printed-cap icon per Codex slot; the Mic pair and logo are special-cased. */
  const CODEX_CAP_ICONS: readonly (IconDefinition | null)[] = [
    faBolt,
    faCheck,
    faXmark,
    faCodeBranch,
    null,
    null,
    null,
  ];
</script>

<script lang="ts">
  /**
   * Stylized vector rendering of the connected hardware console (Creator
   * Micro 2 by default, Codex Micro via `model`).
   *
   * The device is a 4x4 grid of square cells: encoder (top-left), joystick
   * (top-right), and 6 lighted agent-status keys across rows 1-2; the 7
   * action keys (ACT06–ACT12) in rows 3-4 are interactive and highlighted.
   * Clicking (or keyboard-activating) an action key selects its 0-based
   * slot via `onSelectKey`. On the CM2 the action keys are labeled 1–7; on
   * the Codex Micro they carry the printed caps (lightning, checkmark,
   * x-mark, branching; the factory-linked 2U Mic pair rendered as two
   * keycaps under a shared outline; terminal-in-hexagon logo).
   *
   * The encoder and joystick pop small explainer cards describing their
   * fixed (non-configurable) behavior. While `agentKeysInteractive` (a
   * device is connected), the agent keys show numbered slot badges (binding
   * numbering: second row = slots 1-4, top row = slots 5-6 — matching
   * AGENT_KEY_IDS) and clicking an assigned key invokes `onActivateAgentKey`
   * — the same behavior as pressing the physical key.
   */
  import { formatInteger } from '$lib/i18n/format';
  import type { HardwareDeviceModel } from '$features/hardware-console/input/types';
  import MicroKeySlotBadge from '$lib/components/workspace/MicroKeySlotBadge.svelte';

  /** Resolved assignment of one agent-key slot. */
  interface AgentKeySlot {
    workspaceId: string | null;
    /** Workspace display title (may be empty for untitled workspaces). */
    name: string | null;
  }

  interface Props {
    /** Device model to render; controls the action-key faces. */
    model?: HardwareDeviceModel;
    /** 0-based selected action-key slot, or null when none is selected. */
    selectedSlot?: number | null;
    onSelectKey?: (slot: number) => void;
    /** Resolved agent-key assignments in slot order (0-5); null entry = unassigned. */
    agentSlots?: readonly AgentKeySlot[];
    /** Whether the agent keys are interactive (a device is connected). */
    agentKeysInteractive?: boolean;
    /** Activating an assigned agent key — same behavior as the physical key. */
    onActivateAgentKey?: (slot: number, workspaceId: string) => void;
  }

  let {
    model = 'creator-micro-2',
    selectedSlot = null,
    onSelectKey,
    agentSlots,
    agentKeysInteractive = false,
    onActivateAgentKey,
  }: Props = $props();

  const codex = $derived(model === 'codex-micro');

  // Body: 292x292 viewBox. 4x4 grid of 56x56 square cells with 12-unit gutters.
  const KEY_SIZE = 56;
  const GUTTER = 12;
  const MARGIN = 16;
  const KEY_RX = 9;

  const cell = (col: number, row: number) => ({
    x: MARGIN + col * (KEY_SIZE + GUTTER),
    y: MARGIN + row * (KEY_SIZE + GUTTER),
  });
  const cellCenter = (col: number, row: number) => {
    const { x, y } = cell(col, row);
    return { cx: x + KEY_SIZE / 2, cy: y + KEY_SIZE / 2 };
  };

  // Encoder top-left, joystick top-right.
  const encoder = cellCenter(0, 0);
  const joystick = cellCenter(3, 0);

  // Lighted agent-status keys (LED ids 0-5) in binding-slot order: second
  // row = slots 0-3 (keys 1-4), top row = slots 4-5 (keys 5-6).
  const agentKeyCells = [cell(0, 1), cell(1, 1), cell(2, 1), cell(3, 1), cell(1, 0), cell(2, 0)];

  // Action keys: row of four (slots 0–3), then a row of three (slots 4–6,
  // offset one cell so key 5 sits under key 2). Same geometry on both
  // models; the Codex Micro differs only in the printed key faces.
  const actionKeys = [
    ...[0, 1, 2, 3].map((i) => ({ slot: i, ...cell(i, 2) })),
    ...[4, 5, 6].map((i) => ({ slot: i, ...cell(i - 3, 3) })),
  ];

  // Codex Micro linked Mic pair (ACT10 + ACT11 under the factory 2U cap):
  // two separate keycaps grouped by a shared outline, one mic glyph
  // spanning the pair. The logo key (ACT12) is a terminal-in-hexagon.
  const micPair = { left: cell(1, 3), right: cell(2, 3) };
  const micPairCenter = {
    cx: (micPair.left.x + micPair.right.x + KEY_SIZE) / 2,
    cy: micPair.left.y + KEY_SIZE / 2,
  };
  const logoCenter = cellCenter(3, 3);

  function hexagonPoints(cx: number, cy: number, r: number): string {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(' ');
  }

  function actionKeyAriaLabel(slot: number): string {
    const number = String(slot + 1);
    return codex
      ? m.settings_hardware_codexActionKey_ariaLabel({ number, cap: codexCapLabel(slot) })
      : m.settings_hardware_actionKey_ariaLabel({ number });
  }

  function handleKeydown(event: KeyboardEvent, slot: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectKey?.(slot);
    }
  }

  // Knob / joystick fixed-behavior explainers.
  let openExplainer = $state<'knob' | 'joystick' | null>(null);
  let explainerEl = $state<HTMLElement | null>(null);
  let knobEl = $state<SVGGElement | null>(null);
  let joystickEl = $state<SVGGElement | null>(null);

  function toggleExplainer(which: 'knob' | 'joystick') {
    openExplainer = openExplainer === which ? null : which;
  }

  function handleExplainerKeydown(event: KeyboardEvent, which: 'knob' | 'joystick') {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleExplainer(which);
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') openExplainer = null;
  }

  const explainerLabel = $derived(
    openExplainer === 'knob'
      ? m.settings_hardware_knobExplainer_label()
      : m.settings_hardware_joystickExplainer_label(),
  );

  function handleWindowPointerdown(event: PointerEvent) {
    if (openExplainer === null) return;
    const target = event.target as Node;
    if (
      explainerEl?.contains(target) ||
      knobEl?.contains(target) ||
      joystickEl?.contains(target)
    ) {
      return;
    }
    openExplainer = null;
  }

  function agentKeyAriaLabel(slot: number, assignment: AgentKeySlot | null): string {
    const number = formatInteger(slot + 1);
    if (!assignment?.workspaceId) {
      return m.settings_hardware_agentKeyUnassigned_ariaLabel({ number });
    }
    return m.settings_hardware_agentKey_ariaLabel({
      number,
      name: assignment.name || m.workspace_links_untitled_label(),
    });
  }

  function handleAgentKeydown(event: KeyboardEvent, slot: number, workspaceId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivateAgentKey?.(slot, workspaceId);
    }
  }

  /** SVG transform centering a FontAwesome icon path at (cx, cy) at `size`. */
  function iconTransform(icon: IconDefinition, cx: number, cy: number, size: number): string {
    const [width, height] = icon.icon;
    const scale = size / Math.max(width, height);
    return `translate(${cx - (width * scale) / 2} ${cy - (height * scale) / 2}) scale(${scale})`;
  }

  function iconPath(icon: IconDefinition): string {
    const data = icon.icon[4];
    return Array.isArray(data) ? data.join(' ') : data;
  }

  const deviceGraphicLabel = $derived(
    codex
      ? m.settings_hardware_deviceGraphicCodex_ariaLabel()
      : m.settings_hardware_deviceGraphic_ariaLabel(),
  );
</script>

<svelte:window onkeydown={handleWindowKeydown} onpointerdown={handleWindowPointerdown} />

<div class="relative w-full max-w-[360px]">
  <svg
    viewBox="0 0 292 292"
    role="group"
    aria-label={deviceGraphicLabel}
    class="w-full select-none"
  >
    <!-- Device body -->
    <rect
      x="1"
      y="1"
      width="290"
      height="290"
      rx="14"
      class="fill-muted/40 stroke-border"
      stroke-width="2"
    />

    <!-- Encoder knob (top-left cell): click pops the fixed-behavior explainer -->
    <g
      bind:this={knobEl}
      role="button"
      tabindex="0"
      aria-label={m.settings_hardware_knob_ariaLabel()}
      aria-expanded={openExplainer === 'knob'}
      aria-controls="hardware-console-knob-explainer"
      class="cursor-pointer outline-none group"
      onclick={() => toggleExplainer('knob')}
      onkeydown={(event) => handleExplainerKeydown(event, 'knob')}
    >
      <circle
        cx={encoder.cx}
        cy={encoder.cy}
        r="26"
        stroke-width={openExplainer === 'knob' ? 2.5 : 1.5}
        class={openExplainer === 'knob'
          ? 'fill-muted stroke-primary'
          : 'fill-muted stroke-border group-hover:stroke-primary/60 group-focus-visible:stroke-primary'}
      />
      <circle cx={encoder.cx} cy={encoder.cy - 16} r="4" class="fill-border" />
    </g>

    <!-- Joystick (top-right cell): click pops the fixed-behavior explainer -->
    <g
      bind:this={joystickEl}
      role="button"
      tabindex="0"
      aria-label={m.settings_hardware_joystick_ariaLabel()}
      aria-expanded={openExplainer === 'joystick'}
      aria-controls="hardware-console-joystick-explainer"
      class="cursor-pointer outline-none group"
      onclick={() => toggleExplainer('joystick')}
      onkeydown={(event) => handleExplainerKeydown(event, 'joystick')}
    >
      <circle
        cx={joystick.cx}
        cy={joystick.cy}
        r="26"
        stroke-width={openExplainer === 'joystick' ? 2.5 : 1.5}
        class={openExplainer === 'joystick'
          ? 'fill-muted stroke-primary'
          : 'fill-muted stroke-border group-hover:stroke-primary/60 group-focus-visible:stroke-primary'}
      />
      <circle cx={joystick.cx} cy={joystick.cy} r="12" class="fill-border" />
    </g>

    <!-- Lighted agent-status keys (binding-slot order; interactive while connected) -->
    {#each agentKeyCells as key, slot (slot)}
      {@const assignment = agentSlots?.[slot] ?? null}
      {@const workspaceId = assignment?.workspaceId ?? null}
      {#if agentKeysInteractive}
        <g
          role="button"
          tabindex="0"
          aria-label={agentKeyAriaLabel(slot, assignment)}
          aria-disabled={workspaceId === null ? true : undefined}
          class={workspaceId !== null ? 'cursor-pointer outline-none group' : 'outline-none'}
          onclick={workspaceId !== null
            ? () => onActivateAgentKey?.(slot, workspaceId)
            : undefined}
          onkeydown={workspaceId !== null
            ? (event) => handleAgentKeydown(event, slot, workspaceId)
            : undefined}
        >
          {#if assignment?.workspaceId}
            <title>{assignment.name || m.workspace_links_untitled_label()}</title>
          {/if}
          <rect
            x={key.x}
            y={key.y}
            width={KEY_SIZE}
            height={KEY_SIZE}
            rx={KEY_RX}
            stroke-width="1.5"
            class={workspaceId !== null
              ? 'fill-muted stroke-border group-hover:fill-muted/70 group-hover:stroke-primary/60 group-focus-visible:stroke-primary'
              : 'fill-muted stroke-border'}
          />
          <foreignObject x={key.x + 4} y={key.y + 4} width="20" height="20">
            {#if assignment?.workspaceId}
              <MicroKeySlotBadge workspaceId={assignment.workspaceId} {slot} />
            {:else}
              <span
                class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border/40 bg-muted/30 text-[10px] font-medium leading-none text-subtle/60 a11y-ignore"
                aria-hidden="true"
              >
                {formatInteger(slot + 1)}
              </span>
            {/if}
          </foreignObject>
        </g>
      {:else}
        <rect
          x={key.x}
          y={key.y}
          width={KEY_SIZE}
          height={KEY_SIZE}
          rx={KEY_RX}
          stroke-width="1.5"
          class="fill-muted stroke-border"
        />
      {/if}
    {/each}

    <!-- Codex Micro: shared outline grouping the factory-linked Mic pair -->
    {#if codex}
      <rect
        x={micPair.left.x - 4}
        y={micPair.left.y - 4}
        width={micPair.right.x + KEY_SIZE - micPair.left.x + 8}
        height={KEY_SIZE + 8}
        rx={KEY_RX + 3}
        stroke-width="1.5"
        stroke-dasharray="5 3"
        class="fill-none stroke-primary/40 pointer-events-none"
      />
    {/if}

    <!-- Action keys (highlighted, click-to-select; CM2 labeled 1-7, Codex printed caps) -->
    {#each actionKeys as key (key.slot)}
      {@const capIcon = codex ? CODEX_CAP_ICONS[key.slot] : null}
      <g
        role="button"
        tabindex="0"
        aria-label={actionKeyAriaLabel(key.slot)}
        aria-pressed={selectedSlot === key.slot}
        class="cursor-pointer outline-none group"
        onclick={() => onSelectKey?.(key.slot)}
        onkeydown={(event) => handleKeydown(event, key.slot)}
      >
        <rect
          x={key.x}
          y={key.y}
          width={KEY_SIZE}
          height={KEY_SIZE}
          rx={KEY_RX}
          stroke-width={selectedSlot === key.slot ? 2.5 : 1.5}
          class={selectedSlot === key.slot
            ? 'fill-primary/25 stroke-primary'
            : 'fill-primary/10 stroke-primary/50 group-hover:fill-primary/20 group-focus-visible:stroke-primary'}
        />
        {#if !codex}
          <text
            x={key.x + KEY_SIZE / 2}
            y={key.y + KEY_SIZE / 2}
            text-anchor="middle"
            dominant-baseline="central"
            class={'text-[13px] font-semibold pointer-events-none ' +
              (selectedSlot === key.slot ? 'fill-primary' : 'fill-foreground/70')}
          >
            {key.slot + 1}
          </text>
        {:else if capIcon}
          <path
            d={iconPath(capIcon)}
            transform={iconTransform(capIcon, key.x + KEY_SIZE / 2, key.y + KEY_SIZE / 2, 20)}
            class={'pointer-events-none ' +
              (selectedSlot === key.slot ? 'fill-primary' : 'fill-foreground/70')}
          />
        {:else if key.slot === 6}
          <!-- Codex logo key: terminal inside a hexagon -->
          <polygon
            points={hexagonPoints(logoCenter.cx, logoCenter.cy, 17)}
            stroke-width="1.5"
            class={'fill-none pointer-events-none ' +
              (selectedSlot === key.slot ? 'stroke-primary' : 'stroke-foreground/70')}
          />
          <path
            d={iconPath(faTerminal)}
            transform={iconTransform(faTerminal, logoCenter.cx, logoCenter.cy, 13)}
            class={'pointer-events-none ' +
              (selectedSlot === key.slot ? 'fill-primary' : 'fill-foreground/70')}
          />
        {/if}
      </g>
    {/each}

    <!-- Codex Micro: one mic glyph spanning the linked pair (factory 2U cap) -->
    {#if codex}
      <path
        d={iconPath(faMicrophone)}
        transform={iconTransform(faMicrophone, micPairCenter.cx, micPairCenter.cy, 20)}
        class={'pointer-events-none ' +
          (selectedSlot === 4 || selectedSlot === 5 ? 'fill-primary' : 'fill-foreground/70')}
      />
    {/if}
  </svg>

  <!-- Knob / joystick fixed-behavior explainer card -->
  {#if openExplainer !== null}
    <div
      bind:this={explainerEl}
      id="hardware-console-{openExplainer}-explainer"
      role="dialog"
      aria-label={explainerLabel}
      class="absolute top-2 z-20 w-[260px] rounded-lg border border-border bg-popover p-3 shadow-lg {openExplainer ===
      'knob'
        ? 'left-2'
        : 'right-2'}"
    >
      <p class="text-xs font-medium text-foreground">{explainerLabel}</p>
      {#if openExplainer === 'knob'}
        <p class="text-xs text-subtle mt-1.5">
          {m.settings_hardware_knobExplainer_rotate_description()}
        </p>
        <p class="text-xs text-subtle mt-1.5">
          {m.settings_hardware_knobExplainer_click_description()}
        </p>
      {:else}
        <p class="text-xs text-subtle mt-1.5">
          {m.settings_hardware_joystickExplainer_hold_description()}
        </p>
        <p class="text-xs text-subtle mt-1.5">
          {m.settings_hardware_joystickExplainer_cancel_description()}
        </p>
      {/if}
      <p class="text-xs text-subtle/70 mt-2 italic">
        {m.settings_hardware_explainer_fixed_description()}
      </p>
    </div>
  {/if}
</div>
