import {
  ArrowsLeftRightIcon,
  ChatIcon,
  CircleIcon,
  ClockIcon,
  CubeIcon,
  DatabaseIcon,
  DesktopIcon,
  FileTextIcon,
  FlagIcon,
  GearIcon,
  GitBranchIcon,
  GlobeIcon,
  HardDriveIcon,
  HardDrivesIcon,
  PackageIcon,
  PlayIcon,
  PlugIcon,
  StopIcon,
  UserIcon,
  type Icon,
} from '@phosphor-icons/react';

interface DiagramNodeIcon {
  component: Icon;
  name: string;
}

const icon = (name: string, component: Icon): DiagramNodeIcon => ({ name, component });
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
