<script lang="ts">
  /**
   * Non-interactive micro key-slot square: the small rounded bordered square
   * showing the 1-based slot number a workspace occupies on the hardware
   * console. Shared visual between the interactive workspace-card badge
   * (`MicroKeySlotBadge` composes it inside its click target) and toast
   * surfaces that tag a workspace with its slot. Consumers gate rendering on
   * micro connectivity + a resolved slot; this component only draws.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    /** Resolved 0-based slot the workspace occupies. */
    slot: number;
    /** Extra classes (e.g. hover states from an interactive wrapper). */
    class?: string;
  }

  let { slot, class: className = '' }: Props = $props();

  /**
   * Pastel rainbow per-slot palette (0-based slot → classes), cycling with
   * `slot % 6` for safety: red/rose, orange/amber, yellow, green/emerald,
   * blue/sky, purple/violet. Soft translucent backgrounds/borders work in
   * both themes; the text shade flips for dark mode.
   */
  const SLOT_COLOR_CLASSES = [
    'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300',
    'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300',
    'border-yellow-500/30 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
    'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    'border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300',
    'border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300',
  ];

  const slotColorClasses = $derived(
    SLOT_COLOR_CLASSES[((slot % SLOT_COLOR_CLASSES.length) + SLOT_COLOR_CLASSES.length) %
      SLOT_COLOR_CLASSES.length]
  );
</script>

<span
  class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-medium leading-none a11y-ignore {slotColorClasses} {className}"
  title={m.workspace_microKeyBadge_tooltip({ number: formatInteger(slot + 1) })}
>
  {formatInteger(slot + 1)}
</span>
