<script lang="ts">
  // Minimal mock for svelte-fa to avoid FontAwesome imports in tests
  interface Props {
    icon?: any;
    class?: string;
    size?: string;
  }

  let { icon: _icon, class: className, size }: Props = $props();
</script>

<span class="mock-fa {className}" data-size={size}></span>
