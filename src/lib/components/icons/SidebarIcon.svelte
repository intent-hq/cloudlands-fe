<script lang="ts">
  import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';

  interface Props {
    size?: number;
    class?: string;
    /** Which side the sidebar panel is on. 'left' is the default orientation, 'right' flips it horizontally. */
    side?: 'left' | 'right';
  }

  let { size = 16, class: className = '', side = 'left' }: Props = $props();
</script>

<SidebarSimpleIcon
  {size}
  weight="regular"
  mirrored={side === 'right'}
  class={className}
  aria-hidden="true"
/>
