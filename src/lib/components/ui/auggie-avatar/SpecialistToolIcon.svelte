<script lang="ts">
  /**
   * SpecialistToolIcon - Renders just the specialist tool icon (no avatar)
   *
   * Used in settings and other places where you want to show the specialist
   * icon standalone without the full AuggieAvatar.
   */
  import {
  getSpecialistIcon,
  getSpecialistGlowColor,
} from './specialist-icons';

  interface Props {
    /** Specialist ID - can be any specialist ID, but only built-in specialists have custom icons */
    specialist: string;
    /** Size of the icon in pixels */
    size?: number;
    /** Whether to show the glow effect */
    glow?: boolean;
    /** Use muted/inherit color instead of specialist glow color */
    muted?: boolean;
    /** Additional CSS classes */
    class?: string;
  }

  let {
    specialist,
    size = 20,
    glow = false,
    muted = false,
    class: className = '',
  }: Props = $props();

  let iconSvg = $derived(getSpecialistIcon(specialist));
  let glowColor = $derived(getSpecialistGlowColor(specialist));
</script>

{#if iconSvg}
  <div
    class="inline-flex items-center justify-center text-muted {className}"
    style="
      width: {size}px;
      height: {size}px;

      {glow && !muted
      ? `filter: drop-shadow(0 0 3px ${glowColor}) drop-shadow(0 0 6px ${glowColor}40);`
      : ''}
    "
  >
    {@html iconSvg}
  </div>
{/if}
