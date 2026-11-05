<script lang="ts">
  import AppleLogoIcon from 'phosphor-svelte/lib/AppleLogoIcon';
  import LinuxLogoIcon from 'phosphor-svelte/lib/LinuxLogoIcon';
  import WindowsLogoIcon from 'phosphor-svelte/lib/WindowsLogoIcon';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import type { MachinePlatform } from './machine-facts';

  let { platform }: { platform: MachinePlatform } = $props();

  // i18n-ignore (operating system brand names)
  const NAMES: Record<MachinePlatform, string> = {
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
  };
  const ICONS = { macos: AppleLogoIcon, windows: WindowsLogoIcon, linux: LinuxLogoIcon };
  const Icon = $derived(ICONS[platform]);
</script>

<Tooltip content={NAMES[platform]} class="inline-flex">
  <span role="img" aria-label={NAMES[platform]} class="inline-flex text-muted-foreground">
    <Icon size={14} weight="fill" aria-hidden="true" />
  </span>
</Tooltip>
