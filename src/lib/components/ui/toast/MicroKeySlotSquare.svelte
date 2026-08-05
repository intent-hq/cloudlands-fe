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
  import { slotColorClasses as slotColorClassesFor } from '$lib/components/ui/toast/micro-key-slot-colors';

  interface Props {
    /** Resolved 0-based slot the workspace occupies. */
    slot: number;
    /** Extra classes (e.g. hover states from an interactive wrapper). */
    class?: string;
  }

  let { slot, class: className = '' }: Props = $props();

  const slotColorClasses = $derived(slotColorClassesFor(slot));
</script>

<span
  class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-medium leading-none a11y-ignore {slotColorClasses} {className}"
  title={m.workspace_microKeyBadge_tooltip({ number: formatInteger(slot + 1) })}
>
  {formatInteger(slot + 1)}
</span>
