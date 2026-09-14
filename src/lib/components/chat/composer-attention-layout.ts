export function getComposerAttentionBodyMaxHeight(panelHeight: number): number {
  if (panelHeight <= 0) return 480;
  const shortPanelBody = Math.min(160, panelHeight - 140);
  return Math.max(96, Math.min(Math.max(panelHeight - 240, shortPanelBody), 480));
}
