<script lang="ts">
  import HardDrivesIcon from 'phosphor-svelte/lib/HardDrivesIcon';

  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 16, class: className = '' }: Props = $props();
</script>

<HardDrivesIcon {size} weight="regular" class={className} aria-hidden="true" />
