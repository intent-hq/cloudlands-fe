<script lang="ts">
  export let icon: any = {};
  let className: string = '';
  export { className as class };
</script>

<span class="fa-icon {className}" data-icon={icon.iconName || 'icon'}>
  <svg width="16" height="16" viewBox="0 0 16 16">
    <rect width="16" height="16" fill="currentColor" />
  </svg>
</span>
