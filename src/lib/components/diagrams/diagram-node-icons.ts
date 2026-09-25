import type { Component } from 'svelte';
import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRightIcon';
import ChatIcon from 'phosphor-svelte/lib/ChatIcon';
import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
import DatabaseIcon from 'phosphor-svelte/lib/DatabaseIcon';
import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
import FlagIcon from 'phosphor-svelte/lib/FlagIcon';
import GearIcon from 'phosphor-svelte/lib/GearIcon';
import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
import HardDriveIcon from 'phosphor-svelte/lib/HardDriveIcon';
import HardDrivesIcon from 'phosphor-svelte/lib/HardDrivesIcon';
import PackageIcon from 'phosphor-svelte/lib/PackageIcon';
import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
import PlugIcon from 'phosphor-svelte/lib/PlugIcon';
import StopIcon from 'phosphor-svelte/lib/StopIcon';
import UserIcon from 'phosphor-svelte/lib/UserIcon';

interface DiagramNodeIcon {
  component: Component<any>;
  name: string;
}

const icon = (name: string, component: Component<any>): DiagramNodeIcon => ({ name, component });
const fallbackIcon = icon('cube', CubeIcon);

const NODE_ICON_BY_KIND: Record<string, DiagramNodeIcon> = {
  actor: icon('user', UserIcon),
  data: icon('database', DatabaseIcon),
  data_store: icon('hard-drive', HardDriveIcon),
  db: icon('database', DatabaseIcon),
  decision: icon('code-branch', GitBranchIcon),
  end: icon('stop', StopIcon),
  event: icon('clock', ClockIcon),
  external: icon('globe', GlobeIcon),
  file: icon('file-lines', FileTextIcon),
  interface: icon('plug', PlugIcon),
  milestone: icon('flag', FlagIcon),
  module: fallbackIcon,
  node: fallbackIcon,
  package: icon('box', PackageIcon),
  process: icon('gear', GearIcon),
  queue: icon('message', ChatIcon),
  router: icon('code-branch', GitBranchIcon),
  server: icon('server', HardDrivesIcon),
  service: icon('server', HardDrivesIcon),
  start: icon('play', PlayIcon),
  state: icon('circle', CircleIcon),
  switch: icon('right-left', ArrowsLeftRightIcon),
  ui_component: icon('desktop', DesktopIcon),
};

export function getDiagramNodeIcon(kind?: string): DiagramNodeIcon {
  return (kind && NODE_ICON_BY_KIND[kind]) || fallbackIcon;
}
