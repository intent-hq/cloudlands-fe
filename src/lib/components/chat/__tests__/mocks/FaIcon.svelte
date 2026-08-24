<script lang="ts">
  interface Props {
    icon?: { iconName?: string };
    class?: string;
    size?: string | number;
  }

  let { icon, class: className, size }: Props = $props();
</script>

<svg
  class={className}
  data-icon={icon?.iconName}
  data-size={size}
  aria-hidden="true"
  viewBox="0 0 16 16"
></svg>
