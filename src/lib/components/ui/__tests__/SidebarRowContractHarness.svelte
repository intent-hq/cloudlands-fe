<script lang="ts">
  import Provider from '../sidebar/sidebar-provider.svelte';
  import Menu from '../sidebar/sidebar-menu.svelte';
  import MenuButton from '../sidebar/sidebar-menu-button.svelte';
  import MenuItem from '../sidebar/sidebar-menu-item.svelte';
</script>

<Provider persist={false} shortcut={null} class="w-72 min-h-0">
  <Menu>
    <MenuItem>
      <MenuButton label="Overview" aria-label="Overview" isActive />
    </MenuItem>
    <MenuItem>
      <MenuButton label="Settings" aria-label="Settings" />
    </MenuItem>
  </Menu>
</Provider>
