import { setDockLabEnabled } from '$lib/dock-lab';

const ENABLE_DOCK = 'enable-experimental-dock';
const DISABLE_DOCK = 'disable-experimental-dock';

export function isLabCommandHidden(commandId: string, enabled: boolean): boolean {
  return commandId === (enabled ? ENABLE_DOCK : DISABLE_DOCK);
}

export function runLabCommand(commandId: string): boolean {
  if (commandId !== ENABLE_DOCK && commandId !== DISABLE_DOCK) return false;
  void setDockLabEnabled(commandId === ENABLE_DOCK);
  return true;
}
