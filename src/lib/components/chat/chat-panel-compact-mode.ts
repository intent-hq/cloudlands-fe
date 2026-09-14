export function resolveChatPanelCompactMode(
  current: boolean,
  panelHeight: number,
  enterHeight: number,
  exitHeight: number,
): boolean {
  if (panelHeight <= 0) return current;
  if (current) return panelHeight <= exitHeight;
  return panelHeight < enterHeight;
}
