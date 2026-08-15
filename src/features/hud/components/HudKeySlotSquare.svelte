<script lang="ts">
  /**
   * Non-interactive HUD key-slot square: a sharp-cornered (no border-radius)
   * square showing the 1-based hardware-console slot number a workspace
   * occupies, tinted with the shared per-slot palette
   * (`micro-key-slot-colors`). Shared by the HUD grid card and the takeover
   * header — size comes from the `class` prop so each surface picks its own.
   * Consumers gate rendering on a resolved slot; this component only draws.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { slotColorClasses as slotColorClassesFor } from '$features/hardware-console/components/micro-key-slot-colors';

  interface Props {
    /** Resolved 0-based slot the workspace occupies. */
    slot: number;
    /** Sizing/extra classes (e.g. `h-4 w-4` on the grid card, larger in the takeover header). */
    class?: string;
  }

  let { slot, class: className = 'h-4 w-4' }: Props = $props();

  const slotColorClasses = $derived(slotColorClassesFor(slot));
</script>

<span
  class="type-caption flex shrink-0 items-center justify-center rounded-none border font-medium leading-none a11y-ignore {slotColorClasses} {className}"
  title={m.workspace_microKeyBadge_tooltip({ number: formatInteger(slot + 1) })}
>
  {formatInteger(slot + 1)}
</span>
